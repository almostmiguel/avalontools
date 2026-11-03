// Keep the original book's regression checks independent of later book imports.
// Cross-book catalog behavior and PC2 coverage are checked in pc2.test.mjs.
export const pc1Payload = payload => Object.fromEntries(Object.entries(payload).map(([key, value]) => [key,
  Array.isArray(value) ? value.filter(entry => entry.source !== "PC2" && entry.id !== "PC2") : key === "_meta" ? {} : value,
]));
