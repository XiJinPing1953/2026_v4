package com.xintuo.scale;

public final class OwnedResourceTest {
    private static void check(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
    public static void main(String[] args) throws Exception {
        int[] closes = {0};
        for (int i = 0; i < 1000; i++) {
            OwnedResource<Object> attempt = new OwnedResource<>(value -> closes[0]++);
            attempt.assign(new Object());
            attempt.release(); attempt.release();
            check(attempt.get() == null, "retired resource is still reachable");
        }
        check(closes[0] == 1000, "failed retries must each release exactly once");
        OwnedResource<Object> late = new OwnedResource<>(value -> closes[0]++);
        late.release(); late.assign(new Object()); late.release();
        check(closes[0] == 1001, "late acquisition after cancel must release");
        OwnedResource<Object> old = new OwnedResource<>(value -> closes[0]++);
        OwnedResource<Object> next = new OwnedResource<>(value -> closes[0]++);
        old.assign(new Object()); old.release(); next.assign(new Object()); old.release();
        check(next.get() != null, "retired callback closed new connection"); next.release();
        int[] attempts = {0};
        OwnedResource<Object> broken = new OwnedResource<>(value -> { attempts[0]++; throw new Exception("close failed"); });
        broken.assign(new Object());
        try { broken.release(); throw new AssertionError("release failure hidden"); } catch (Exception expected) {}
        broken.release(); check(attempts[0] == 1 && broken.get() == null, "release failure causes repeated cleanup");
        System.out.println("OwnedResource: 1000 retries, late acquisition, stale callbacks and close failure passed");
    }
}
