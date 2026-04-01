const AUTOMATION_NOTE_MESSAGES = {
  eventDateMismatch: "PDF has different event date.",
  locationMismatch: "PDF has different location than sale.",
  validationFailed: "PDF content could not be recognized by automation.",
  sendFailed: "PDF could not be sent via API.",
  stubhubPrecheckFailed: "PDF not sent, sale not found via API.",
  tvSaleCannotAutoFulfill: "TV sale, cannot auto fulfill.",
};

const AUTOMATION_NOTE_LIST = Object.values(AUTOMATION_NOTE_MESSAGES);

function normalizeNoteText(value) {
  return String(value || "").trim().toLowerCase();
}

function containsAutomationNote(value) {
  const normalized = normalizeNoteText(value);

  if (!normalized) {
    return false;
  }

  return AUTOMATION_NOTE_LIST.some((note) => normalized.includes(normalizeNoteText(note)));
}

function appendAutomationNote(existingComment, note) {
  const existingText = String(existingComment || "").trim();
  const noteText = String(note || "").trim();

  if (!noteText) {
    return existingText;
  }

  if (normalizeNoteText(existingText).includes(normalizeNoteText(noteText))) {
    return existingText;
  }

  if (!existingText) {
    return noteText;
  }

  return `${noteText} - ${existingText}`;
}

module.exports = {
  AUTOMATION_NOTE_MESSAGES,
  AUTOMATION_NOTE_LIST,
  containsAutomationNote,
  appendAutomationNote,
};
