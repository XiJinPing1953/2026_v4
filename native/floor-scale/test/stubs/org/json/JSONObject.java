package org.json;
import java.util.LinkedHashMap;
import java.util.Map;

/** Only the producer API used by the driver; no parser or application logic. */
public final class JSONObject {
    private final Map<String, Object> fields = new LinkedHashMap<>();
    public JSONObject put(String key, Object value) { fields.put(key, value); return this; }
    private static String quote(String text) { return "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\""; }
    public String toString() {
        StringBuilder out = new StringBuilder("{");
        for (Map.Entry<String, Object> field : fields.entrySet()) {
            if (out.length() > 1) out.append(',');
            out.append(quote(field.getKey())).append(':');
            Object value = field.getValue();
            out.append(value == null ? "null" : value instanceof String ? quote((String) value) : value.toString());
        }
        return out.append('}').toString();
    }
}
