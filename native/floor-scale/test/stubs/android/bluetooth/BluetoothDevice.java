package android.bluetooth;
import android.content.Context;
public final class BluetoothDevice {
    public static final int TRANSPORT_LE = 2;
    private final BluetoothAdapter adapter;
    public final String address;
    BluetoothDevice(BluetoothAdapter adapter, String address) { this.adapter = adapter; this.address = address; }
    public BluetoothGatt connectGatt(Context context, boolean autoConnect, BluetoothGattCallback callback, int transport) {
        if (autoConnect || transport != TRANSPORT_LE) throw new AssertionError("unexpected connection mode");
        if (adapter.connectThrows) throw new IllegalStateException("injected connect failure");
        if (adapter.returnNull) return null;
        BluetoothGatt gatt = new BluetoothGatt(callback); adapter.gatts.add(gatt); return gatt;
    }
}
