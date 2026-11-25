const prefix = 'bazar-zipa-2026:draft:';

export function draftKey(puesto, participant, rubricVersion) {
  return prefix + JSON.stringify([puesto, participant, rubricVersion]);
}

export function readDraft(storage, key) {
  return JSON.parse(storage.getItem(key) ?? 'null');
}

export function writeDraft(storage, key, fields) {
  const saved = JSON.stringify(fields);
  storage.setItem(key, saved);
  return saved;
}

export function clearConfirmedDraft(storage, key, saved) {
  if (saved !== undefined && storage.getItem(key) === saved) storage.removeItem(key);
}
