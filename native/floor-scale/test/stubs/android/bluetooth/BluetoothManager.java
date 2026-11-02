package android.bluetooth;
public final class BluetoothManager {
    private final BluetoothAdapter adapter;
    public BluetoothManager(BluetoothAdapter adapter) { this.adapter = adapter; }
    public BluetoothAdapter getAdapter() { return adapter; }
}
