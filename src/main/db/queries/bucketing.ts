// All expressions bucket by LOCAL calendar date and return the LOCAL midnight as a UTC ms
// timestamp (using the 'utc' modifier so the result matches new Date(y,m,d).getTime() in JS).
// Shared by any query that buckets a `timestamp` column to the same year/month/day grid the
// timeline histogram uses, so bars from different tables line up on the same x-axis.
export function bucketExprSql(zoomLevel: string, column = 'timestamp'): string {
  if (zoomLevel === 'year') {
    return `CAST(strftime('%s', strftime('%Y', datetime(${column}/1000, 'unixepoch', 'localtime')) || '-01-01', 'utc') AS INTEGER) * 1000`
  }
  if (zoomLevel === 'month') {
    return `CAST(strftime('%s', strftime('%Y-%m', datetime(${column}/1000, 'unixepoch', 'localtime')) || '-01', 'utc') AS INTEGER) * 1000`
  }
  return `CAST(strftime('%s', date(datetime(${column}/1000, 'unixepoch', 'localtime')), 'utc') AS INTEGER) * 1000`
}
