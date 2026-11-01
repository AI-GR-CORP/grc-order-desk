import { describe, expect, it } from 'vitest';
import { clueConflicts, findClues } from '../src/ai/signals';

const keys = (parts: Parameters<typeof findClues>[0], strongOnly = false) =>
  [...new Set(findClues(parts).filter((c) => !strongOnly || c.strong).map((c) => c.key))].sort();

describe('findClues', () => {
  it('the PRIMARK top-quantities thread is a bulk order', () => {
    const parts = [
      { subject: "SS27 - PRIMARK Men's Elastic - GRC TOP Qtys", body: 'Hi Rashimi, Please find attached the new order with the top quantities. Kindly proceed with bulk production and arrange delivery accordingly.' },
      { subject: 'Re: SS27 - PRIMARK', body: 'Hi Amila, Pls revise POs for unit price $0.078/ meter' },
    ];
    expect(keys(parts, true)).toContain('bulk');
    expect(clueConflicts({ isOrder: true, orderType: 'development', topics: [] }, findClues(parts))).toEqual([
      'marked Development, but the emails mention a PO or a bulk order',
    ]);
    expect(clueConflicts({ isOrder: true, orderType: 'bulk', topics: [] }, findClues(parts))).toEqual([]);
  });

  it('a new inquiry with reference samples is development, with no order clues', () => {
    const parts = [{ subject: 'Enquiry for 20MM elastic tape', body: 'We need 20MM plain elastic, please share quotation. Reference sample sent by courier. Payment terms 30 days.' }];
    expect(keys(parts, true)).not.toContain('bulk');
    expect(keys(parts)).toContain('development');
    // "payment terms" in a quote is only a weak hint: no complaint about a missing payment topic
    expect(clueConflicts({ isOrder: true, orderType: 'development', topics: [] }, findClues(parts))).toEqual([]);
    // calling it bulk with no order mentioned gets flagged for a person
    expect(clueConflicts({ isOrder: true, orderType: 'bulk', topics: [] }, findClues(parts))).toEqual([
      'marked Bulk, but no order is mentioned and the emails look like development',
    ]);
  });

  it('finds topics: complaint, payment, PP / sample approval, lab', () => {
    expect(keys([{ body: 'We received short quantity and shade variation in the last lot. This is a complaint.' }], true)).toEqual(['complaint']);
    expect(keys([{ body: 'Kindly release the outstanding amount, payment reminder attached.' }], true)).toEqual(['payment_followup']);
    expect(keys([{ body: 'Please send PP sample for approval before bulk.' }], true)).toEqual(expect.arrayContaining(['pp_approval']));
    expect(keys([{ body: 'Sample approval received from the brand.' }], true)).toContain('pp_approval');
    expect(keys([{ body: 'BV test report attached, EPT passed.' }], true)).toContain('lab_approval');
    expect(keys([{ body: 'see attachment', attachments: ['Intertek_Test_Report_4512.pdf'] }], true)).toContain('lab_approval');
  });

  it('a PO attachment is a strong order clue', () => {
    expect(keys([{ body: 'PFA', attachments: ['PO_4512_GRC.pdf'] }], true)).toContain('bulk');
    expect(keys([{ body: 'PFA', attachments: ['photo.jpg', 'artwork.ai'] }], true)).toEqual([]);
  });

  it('avoids false alarms', () => {
    expect(keys([{ body: 'LC Waikiki boxer waistband 40MM' }])).not.toContain('bulk'); // a brand, not a letter of credit
    expect(keys([{ body: 'Our office: PO Box 1234, Colombo' }])).not.toContain('bulk'); // an address, not a PO
    expect(keys([{ body: 'Ahold Delhaize Nederland BV' }], true)).not.toContain('lab_approval'); // a company suffix
    expect(keys([{ body: 'Please match the approved sample in bulk' }], true)).not.toContain('pp_approval');
  });

  it('flags a missing topic and a non-order with order clues', () => {
    const clues = findClues([{ body: 'Lab test report for PO 4512 attached. Colour fastness failed.' }]);
    expect(clueConflicts({ isOrder: true, orderType: 'bulk', topics: [] }, clues)).toEqual(["the emails mention a lab test or approval, but that topic wasn't added"]);
    expect(clueConflicts({ isOrder: true, orderType: 'bulk', topics: ['lab_approval'] }, clues)).toEqual([]);
    expect(clueConflicts({ isOrder: false, orderType: 'bulk', topics: [] }, clues)).toEqual(['marked as not an order, but the emails mention an order or a complaint']);
  });
});
