package android.os;
import java.util.PriorityQueue;

/** Deterministic main-loop substitute. Android scheduling itself is not under test. */
public final class Handler {
    private static long now, sequence;
    private static final PriorityQueue<Task> tasks = new PriorityQueue<>();
    private static final class Task implements Comparable<Task> {
        final Runnable runnable; final long at, order;
        Task(Runnable runnable, long at) { this.runnable = runnable; this.at = at; order = sequence++; }
        public int compareTo(Task other) { int time = Long.compare(at, other.at); return time != 0 ? time : Long.compare(order, other.order); }
    }
    public Handler(Looper looper) {}
    public boolean post(Runnable runnable) { return postDelayed(runnable, 0); }
    public boolean postDelayed(Runnable runnable, long delay) { tasks.add(new Task(runnable, now + delay)); return true; }
    public void removeCallbacks(Runnable runnable) { tasks.removeIf(task -> task.runnable == runnable); }
    public static void runReady() { advanceBy(0); }
    public static void advanceBy(long milliseconds) {
        long target = now + milliseconds; int executed = 0;
        while (!tasks.isEmpty() && tasks.peek().at <= target) {
            if (++executed > 100000) throw new AssertionError("unbounded handler work");
            Task task = tasks.remove(); now = task.at; task.runnable.run();
        }
        now = target;
    }
    public static int pendingCount() { return tasks.size(); }
    public static void reset() { tasks.clear(); now = 0; sequence = 0; }
}
