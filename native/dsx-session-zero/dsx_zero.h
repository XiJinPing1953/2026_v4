// Volatile gross-weight reference for a 0.5 kg display, single 1000 kg platform.
// Feed one NEW, valid sensor conversion per call, with monotonic ms and signed mg.
// Use reset on board startup, recalibration or sensor replacement.
#ifndef DSX_ZERO_H
#define DSX_ZERO_H
#include <stdint.h>
#include <stdbool.h>
typedef struct {
    int32_t offset_mg, anchor_mg, low_mg, high_mg;
    uint32_t first_ms, last_ms, window_ms;
    unsigned count;
    bool started, ready;
} dsx_zero_t;
void dsx_zero_reset(dsx_zero_t *z);
void dsx_zero_interrupt(dsx_zero_t *z);
// gross_mg is the calibrated gross input BEFORE this correction. When ready,
// the working weight is gross_mg - offset_mg. Preserve gross and AD separately.
// During tare/calibration bypass the correction in the caller; never track them.
bool dsx_zero_observe(dsx_zero_t *z, int32_t gross_mg, uint32_t ms, bool allow_tracking);
#endif
