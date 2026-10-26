export async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status}).`);
  try { return await response.json(); }
  catch { throw new Error(`${path} is not valid JSON. Check its commas and brackets.`); }
}
