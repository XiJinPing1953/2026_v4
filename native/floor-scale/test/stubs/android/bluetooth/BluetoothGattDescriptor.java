package android.bluetooth;
import java.util.UUID;
public final class BluetoothGattDescriptor {
    public static final byte[] ENABLE_NOTIFICATION_VALUE = {1, 0}, ENABLE_INDICATION_VALUE = {2, 0};
    private final UUID uuid;
    private final BluetoothGattCharacteristic characteristic;
    public byte[] value;
    public BluetoothGattDescriptor(UUID uuid, BluetoothGattCharacteristic characteristic) { this.uuid = uuid; this.characteristic = characteristic; }
    public UUID getUuid() { return uuid; }
    public BluetoothGattCharacteristic getCharacteristic() { return characteristic; }
    public boolean setValue(byte[] value) { this.value = value; return true; }
}
