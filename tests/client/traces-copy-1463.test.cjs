'use strict';
// #1463: Assistant & style > Advanced style said "Keep local reasoning traces" and described it with
// internal names ("framing reasoner", "task packet") a person cannot decode. The label, the
// description and the on/off confirmations now say what is kept, where, and what is never kept.
const test = require('node:test');
const assert = require('node:assert/strict');
const { SETTINGS_LOCALES, catalogues } = require('./settings-catalogue-b4.cjs');

const SETTINGS = catalogues(SETTINGS_LOCALES);
const KEYS = ['style.framing.traces', 'style.framing.tracesDesc', 'style.framing.tracesOn', 'style.framing.tracesOff'];

// Words from the internal wording each catalogue carried before, in its own language.
const OLD_WORDS = {
  'de-DE': ['Reasoning', 'Aufgabenpaket', 'Rahmen-Reasoner'],
  'es-ES': ['razonamiento', 'paquete de tarea', 'razonador de encuadre'],
  'fr-FR': ['raisonnement', 'paquet de tâche', 'raisonneur de cadrage'],
  'it-IT': ['ragionamento', 'pacchetto di attività', 'ragionatore di inquadramento'],
  'nb-NO': ['resonneringsspor', 'oppgavepakken', 'rammeresonnereren'],
  'nl-NL': ['redeneersporen', 'taakpakket', 'kaderredeneerder'],
  'pt-BR': ['raciocínio', 'pacote de tarefa', 'raciocinador de enquadramento'],
  'sv-SE': ['resonemangsspår', 'uppgiftspaket', 'ramresoneraren'],
};

test('the English label and description name what is kept and what never is, without internal names', () => {
  const en = SETTINGS['en-GB'];
  assert.equal(en['style.framing.traces'], 'Keep a log of shortened tool results');
  for (const key of ['style.framing.traces', 'style.framing.tracesDesc', 'style.framing.tracesOn', 'style.framing.tracesOff']) {
    assert.ok(!/framing reasoner|task packet|reasoning trace/i.test(en[key]), `${key} has no internal name: ${en[key]}`);
  }
  assert.match(en['style.framing.tracesDesc'], /the request, the answer length and the timings/);
  assert.match(en['style.framing.tracesDesc'], /Raw tool output is never saved\./);
  assert.match(en['style.framing.tracesDesc'], /in your workspace/);
});

test('every locale carries real translations of the four keys, not the English copy', () => {
  for (const [locale, words] of Object.entries(OLD_WORDS)) {
    for (const key of KEYS) {
      assert.notEqual(SETTINGS[locale][key], SETTINGS['en-GB'][key], `${locale} ${key} is translated`);
    }
    const desc = SETTINGS[locale]['style.framing.tracesDesc'];
    for (const word of words) assert.ok(!desc.includes(word), `${locale} description no longer uses "${word}"`);
  }
});
