// Display the saved business time at its original precision. A reprint must not
// substitute the phone clock or a later correction timestamp. The server may
// refine the original business hour using its verified first BLE capture.
export function formatFillingPrintTime(value) {
 // CRM stores hour-precision filling_time as YYYY-MM-DD-HH. Older display
 // snapshots may already contain a space/T separator; keep both readable.
 const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T-](\d{2})(?::(\d{2})(?::(\d{2}))?)?)?$/.exec(String(value || '').trim())
 if (!match) return '未记录'
 const [, year, month, day, hour, minute, second] = match
 const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
 if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)
  || (hour !== undefined && Number(hour) > 23) || (minute !== undefined && Number(minute) > 59) || (second !== undefined && Number(second) > 59)) return '未记录'
 const calendar = `${year}-${month}-${day}`
 if (hour === undefined) return `${calendar}（仅日期）`
 if (minute === undefined) return `${calendar} ${hour}时`
 return `${calendar} ${hour}:${minute}`
}
