'use strict';

/**
 * @file Tests unitarios de las reglas de sobrecarga progresiva.
 */

const {
  getProgressionRule,
  GENERIC_RULE,
} = require('../../src/constants/progression');

describe('getProgressionRule', () => {
  it('retorna la regla de fuerza (peso/kg)', () => {
    const rule = getProgressionRule('fuerza');
    expect(rule.metric).toBe('peso');
    expect(rule.unit).toBe('kg');
    expect(rule.defaultIncrement).toBe(2.5);
  });

  it('retorna la regla de salto (altura/cm)', () => {
    const rule = getProgressionRule('salto');
    expect(rule.metric).toBe('altura');
    expect(rule.unit).toBe('cm');
  });

  it('retorna la regla de agilidad (velocidad/seg)', () => {
    const rule = getProgressionRule('agilidad');
    expect(rule.metric).toBe('velocidad');
    expect(rule.unit).toBe('seg');
  });

  it('retorna la regla genérica para una categoría desconocida', () => {
    const rule = getProgressionRule('categoria_inexistente');
    expect(rule).toEqual(GENERIC_RULE);
    expect(rule.metric).toBe('repeticiones');
  });

  it('el incremento de fuerza difiere del de agilidad (lógica distinta)', () => {
    const fuerza = getProgressionRule('fuerza');
    const agilidad = getProgressionRule('agilidad');
    expect(fuerza.defaultIncrement).not.toBe(agilidad.defaultIncrement);
    expect(fuerza.metric).not.toBe(agilidad.metric);
  });
});
