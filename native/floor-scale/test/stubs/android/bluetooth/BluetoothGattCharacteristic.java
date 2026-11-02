package android.bluetooth;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
public final class BluetoothGattCharacteristic {
    public static final int PROPERTY_NOTIFY = 16, PROPERTY_INDICATE = 32, PROPERTY_WRITE_NO_RESPONSE = 4, PROPERTY_WRITE = 8;
    public static final int WRITE_TYPE_NO_RESPONSE = 1, WRITE_TYPE_DEFAULT = 2;
    private final UUID uuid;
    private final int properties;
    public final Map<UUID, BluetoothGattDescriptor> descriptors = new HashMap<>();
    public byte[] value;
    public int writeType;
    public BluetoothGattCharacteristic(UUID uuid, int properties) { this.uuid = uuid; this.properties = properties; }
    public UUID getUuid() { return uuid; }
    public int getProperties() { return properties; }
    public BluetoothGattDescriptor getDescriptor(UUID uuid) { return descriptors.get(uuid); }
    public byte[] getValue() { return value; }
    public boolean setValue(byte[] value) { this.value = value; return true; }
    public void setWriteType(int writeType) { this.writeType = writeType; }
}
