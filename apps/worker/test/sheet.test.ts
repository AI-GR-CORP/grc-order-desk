import { describe, expect, it } from 'vitest';
import { deriveStage } from '../src/sheet/parse-workbook';

describe('deriveStage (sheet wording, typos included)', () => {
  it.each([
    ['SAMPLES DISAPTCH -WAITING FOR CUSTOMER FEEDBACK', 'sample_dispatched'],
    ['DISPATCH THE SAMPLES', 'sample_dispatched'],
    ['CONFIRMED ORDER', 'converted_to_bulk'],
    ['order recived', 'converted_to_bulk'],
    ['Need refence sample from brand', 'awaiting_reference'],
    ['Combo-8 failed, need to remake again', 'rejected_redevelop'],
    ['share the revised price on 26 oct', 'prices_shared'],
    ['UNDER LAB TESTING', 'under_development'],
    ['HOLD BY CUSTOMER', 'on_hold'],
    ['sample ready on 26 oct', 'sample_ready'],
    ['last follow up 23 sep', 'inquiry_received'],
  ])('%s → %s', (text, stage) => expect(deriveStage(text)).toBe(stage));
});
