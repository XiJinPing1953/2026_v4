package android.app;
import android.content.Context;
import android.os.Bundle;
import java.util.ArrayList;
import java.util.List;
public final class Application extends Context {
    public interface ActivityLifecycleCallbacks {
        void onActivityCreated(Activity activity, Bundle state);
        void onActivityStarted(Activity activity);
        void onActivityResumed(Activity activity);
        void onActivityPaused(Activity activity);
        void onActivityStopped(Activity activity);
        void onActivitySaveInstanceState(Activity activity, Bundle state);
        void onActivityDestroyed(Activity activity);
    }
    public final List<ActivityLifecycleCallbacks> callbacks = new ArrayList<>();
    public void registerActivityLifecycleCallbacks(ActivityLifecycleCallbacks callback) { callbacks.add(callback); }
    public void unregisterActivityLifecycleCallbacks(ActivityLifecycleCallbacks callback) { callbacks.remove(callback); }
    public void destroy(Activity activity) {
        activity.destroyed = true;
        for (ActivityLifecycleCallbacks callback : new ArrayList<>(callbacks)) callback.onActivityDestroyed(activity);
    }
}
