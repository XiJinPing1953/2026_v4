package android.bluetooth;
import android.content.Context;
public final class BluetoothDevice {
    public static final int TRANSPORT_LE = 2;
    private final BluetoothAdapter adapter;
    public final String address;
    BluetoothDevice(BluetoothAdapter adapter, String address) { this.adapter = adapter; this.address = address; }
    public BluetoothGatt connectGatt(Context context, boolean autoConnect, BluetoothGattCallback callback, int transport) {
        if (android.os.Build.VERSION.SDK_INT < 23) throw new AssertionError("transport overload unavailable before API 23");
        if (autoConnect || transport != TRANSPORT_LE) throw new AssertionError("unexpected connection mode");
        return connectGatt(context, autoConnect, callback);
    }
    public BluetoothGatt connectGatt(Context context, boolean autoConnect, BluetoothGattCallback callback) {
        if (autoConnect) throw new AssertionError("auto-connect must stay disabled");
        if (adapter.connectThrows) throw new IllegalStateException("injected connect failure");
        if (adapter.returnNull) return null;
        BluetoothGatt gatt = new BluetoothGatt(callback); adapter.gatts.add(gatt); return gatt;
    }
}
