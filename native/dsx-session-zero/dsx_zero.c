#include "dsx_zero.h"

enum { HALF_DIVISION = 250000, CENTER = 25000, BAND = 50000 };
static int32_t abs_mg(int32_t x) { return x < 0 ? -x : x; }
void dsx_zero_reset(dsx_zero_t *z) { *z = (dsx_zero_t){0}; }
void dsx_zero_interrupt(dsx_zero_t *z) { z->count = 0; }

bool dsx_zero_observe(dsx_zero_t *z, int32_t mg, uint32_t ms, bool allow_tracking) {
    if (mg < -1000000000 || mg > 1000000000) { dsx_zero_interrupt(z); return false; }
    uint32_t dt = ms - z->last_ms;
    if (z->started && dt > 3000) dsx_zero_reset(z);
    if (z->started && dt == 0) return z->ready;
    if (dt > 500) dsx_zero_interrupt(z);
    if (!z->started) { z->started = true; z->first_ms = ms; dt = 0; }
    z->last_ms = ms;
    if (!allow_tracking) { z->ready = true; dsx_zero_interrupt(z); return true; }
    if (z->ready && (abs_mg(mg) >= HALF_DIVISION ||
        (abs_mg(mg) > CENTER && (abs_mg(mg - z->anchor_mg) >= HALF_DIVISION ||
                                  abs_mg(mg - z->offset_mg) >= HALF_DIVISION)))) {
        dsx_zero_interrupt(z);
        return true;
    }
    int32_t lo = mg < z->low_mg ? mg : z->low_mg;
    int32_t hi = mg > z->high_mg ? mg : z->high_mg;
    if (!z->count || hi - lo > BAND) {
        z->window_ms = ms;
        z->low_mg = z->high_mg = mg;
        z->count = 1;
    } else {
        z->low_mg = lo; z->high_mg = hi;
        if (z->count < 5) ++z->count;
    }
    uint32_t window = ms - z->window_ms, age = ms - z->first_ms;
    bool stable = z->count >= 5 && window >= 2000;
    // Rounded midpoint, ties towards positive, even for negative weights.
    int32_t sum = z->low_mg + z->high_mg;
    int32_t middle = sum >= 0 ? (sum + 1) / 2 : sum / 2;
    if (!z->ready && (stable || (abs_mg(mg) >= HALF_DIVISION && age >= 2000) || age >= 5000)) {
        if (stable && z->low_mg > -HALF_DIVISION && z->high_mg < HALF_DIVISION)
            z->anchor_mg = z->offset_mg = middle;
        z->ready = true;
        dsx_zero_interrupt(z);
    } else if (z->ready && stable) {
        if (abs_mg(z->low_mg) <= CENTER && abs_mg(z->high_mg) <= CENTER) {
            z->offset_mg = z->anchor_mg = 0;
        } else {
            int32_t delta = middle - z->offset_mg;
            int32_t step = (int32_t)(dt > 500 ? 500 : dt) * 10;
            z->offset_mg += delta < -step ? -step : delta > step ? step : delta;
        }
        if (window >= 4000) dsx_zero_interrupt(z);
    }
    return z->ready;
}
