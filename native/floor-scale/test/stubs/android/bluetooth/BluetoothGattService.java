package android.bluetooth;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
public final class BluetoothGattService {
    public final Map<UUID, BluetoothGattCharacteristic> characteristics = new HashMap<>();
    public BluetoothGattCharacteristic getCharacteristic(UUID uuid) { return characteristics.get(uuid); }
}
