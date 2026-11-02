package android.app;
import android.content.Context;
public final class Activity extends Context {
    public final Application application;
    public boolean destroyed, finishing;
    public Activity(Application application) { this.application = application; }
    public Application getApplication() { return application; }
    @Override public Context getApplicationContext() { return application; }
    public boolean isDestroyed() { return destroyed; }
    public boolean isFinishing() { return finishing; }
}
