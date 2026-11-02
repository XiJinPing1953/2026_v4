package android.bluetooth;
import java.util.UUID;

/** Controllable platform boundary; it contains no floor-driver lifecycle logic. */
public final class BluetoothGatt {
    public static final int GATT_SUCCESS = 0;
    public final BluetoothGattCallback callback;
    public BluetoothGattService service = new BluetoothGattService();
    public boolean closed, disconnectThrows, closeThrows;
    public boolean discoveryAccepted = true, notificationAccepted = true, descriptorAccepted = true, writeAccepted = true;
    public int disconnectCalls, closeCalls, discoveryCalls, notificationCalls, descriptorCalls, writeCalls;
    public BluetoothGattDescriptor lastDescriptor;
    public BluetoothGattCharacteristic lastWrite;
    BluetoothGatt(BluetoothGattCallback callback) { this.callback = callback; }
    public void disconnect() { disconnectCalls++; if (disconnectThrows) throw new IllegalStateException("injected disconnect failure"); }
    public void close() { closeCalls++; if (closeThrows) throw new IllegalStateException("injected close failure"); closed = true; }
    public boolean discoverServices() { discoveryCalls++; return discoveryAccepted; }
    public BluetoothGattService getService(UUID uuid) { return service; }
    public boolean setCharacteristicNotification(BluetoothGattCharacteristic characteristic, boolean enabled) { notificationCalls++; return notificationAccepted; }
    public boolean writeDescriptor(BluetoothGattDescriptor descriptor) { descriptorCalls++; lastDescriptor = descriptor; return descriptorAccepted; }
    public boolean writeCharacteristic(BluetoothGattCharacteristic characteristic) { writeCalls++; lastWrite = characteristic; return writeAccepted; }
}
