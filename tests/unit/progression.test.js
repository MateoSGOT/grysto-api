'use strict';

/**
 * @file Tests unitarios de las reglas de sobrecarga progresiva.
 */

const {
  getProgressionRule,
  GENERIC_RULE,
  getMetricBounds,
  validateMetricValue,
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

describe('getMetricBounds', () => {
  it('devuelve el rango de peso (kg)', () => {
    const b = getMetricBounds('peso');
    expect(b.min).toBe(0);
    expect(b.max).toBe(500);
    expect(b.exclusiveMin).toBe(true);
  });

  it('cae al rango por defecto (repeticiones) si la métrica es desconocida', () => {
    expect(getMetricBounds('metrica_inexistente')).toEqual(getMetricBounds('repeticiones'));
  });
});

describe('validateMetricValue', () => {
  it('acepta un peso real razonable', () => {
    expect(validateMetricValue('peso', 50).ok).toBe(true);
  });

  it('rechaza peso 0 o negativo (mín exclusivo)', () => {
    expect(validateMetricValue('peso', 0).ok).toBe(false);
    expect(validateMetricValue('peso', -5).ok).toBe(false);
  });

  it('rechaza un peso imposible por encima del máximo', () => {
    expect(validateMetricValue('peso', 999).ok).toBe(false);
  });

  it('precisión (%) acepta 0 y 100 pero no 101', () => {
    expect(validateMetricValue('precision', 0).ok).toBe(true);
    expect(validateMetricValue('precision', 100).ok).toBe(true);
    expect(validateMetricValue('precision', 101).ok).toBe(false);
  });

  it('rechaza valores no numéricos', () => {
    expect(validateMetricValue('peso', NaN).ok).toBe(false);
    expect(validateMetricValue('peso', 'muchos').ok).toBe(false);
  });
});
