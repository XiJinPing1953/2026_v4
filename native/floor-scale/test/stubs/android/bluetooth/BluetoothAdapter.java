package android.bluetooth;
import java.util.ArrayList;
import java.util.List;
public final class BluetoothAdapter {
    public boolean enabled = true, returnNull, connectThrows;
    public final List<BluetoothGatt> gatts = new ArrayList<>();
    public boolean isEnabled() { return enabled; }
    public BluetoothDevice getRemoteDevice(String address) { return new BluetoothDevice(this, address); }
    public int liveCount() { int count = 0; for (BluetoothGatt gatt : gatts) if (!gatt.closed) count++; return count; }
}
