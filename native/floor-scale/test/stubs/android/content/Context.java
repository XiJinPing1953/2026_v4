package android.content;
import android.bluetooth.BluetoothManager;
public class Context {
    public static final String BLUETOOTH_SERVICE = "bluetooth";
    public BluetoothManager bluetoothManager;
    public Object getSystemService(String name) { return BLUETOOTH_SERVICE.equals(name) ? bluetoothManager : null; }
    public Context getApplicationContext() { return this; }
}
