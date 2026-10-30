import { describe, it, expect } from "vitest";
import { splitBlockNotes, classify, findLoomUrl, mergeBlockNotes, athleteBlocks, emptySections, type BlockNote } from "./blockNotes";
import { addDays } from "./program";

describe("classify", () => {
  it("knows the lifts in Dutch and English", () => {
    expect(classify("Je squat diepte was top")).toBe("squat");
    expect(classify("Bankdrukken: meer leg drive")).toBe("bench");
    expect(classify("Sumo deadlift lockout")).toBe("deadlift");
    expect(classify("Rows en face pulls voor de bovenrug")).toBe("accessories");
  });
  it("accessory variants never count as the comp lift", () => {
    expect(classify("Split squats 3x10 per been")).toBe("accessories");
    expect(classify("RDL's blijven op RPE 7")).toBe("accessories");
    expect(classify("Leg press zwaarder")).toBe("accessories");
  });
  it("nothing lift-specific → null", () => {
    expect(classify("Slaap goed en eet genoeg deze week.")).toBeNull();
  });
});

describe("splitBlockNotes", () => {
  it("splits a flowing summary sentence by sentence", () => {
    const s = splitBlockNotes(
      "Dit blok draait om volume opbouwen. Je squat ziet er sterk uit, hou je borst hoger uit de gat. " +
        "Bij bench wil ik meer leg drive zien. Dat moet je elke set voelen. " +
        "Deadlift: sumo blijft, focus op de lockout.\n" +
        "Accessoires: rows en RDL's 3x10.",
    );
    expect(s.general).toContain("volume opbouwen");
    expect(s.squat).toContain("borst hoger");
    expect(s.bench).toContain("leg drive");
    expect(s.bench).toContain("elke set voelen"); // follow-up sentence stays with bench
    expect(s.deadlift).toContain("lockout");
    expect(s.accessories).toContain("rows");
    expect(s.squat).not.toContain("leg drive");
  });

  it("respects explicit headings and bullet lists", () => {
    const s = splitBlockNotes(`## Algemeen
- Deload in week 4
**Squat**
- Pauze van 2 tellen
- Knieën naar buiten
Bench:
- Ellebogen onder de stang
Deadlift
- Start trager van de vloer
Accessoires
- Pull-ups toevoegen`);
    expect(s.general).toBe("Deload in week 4");
    expect(s.squat).toBe("• Pauze van 2 tellen\n• Knieën naar buiten");
    expect(s.bench).toBe("Ellebogen onder de stang");
    expect(s.deadlift).toBe("Start trager van de vloer");
    expect(s.accessories).toBe("Pull-ups toevoegen");
  });

  it("a bare link line is left out (the Loom goes in its own field)", () => {
    const s = splitBlockNotes("Accessoires: rows 3x10\nhttps://www.loom.com/share/abc123");
    expect(s.accessories).toBe("rows 3x10");
  });

  it("a line under one heading that names another lift moves there", () => {
    const s = splitBlockNotes("Squat:\n- Diepte goed\n- Bench blijft op 3x5");
    expect(s.squat).toBe("Diepte goed");
    expect(s.bench).toBe("Bench blijft op 3x5");
  });
});

describe("findLoomUrl", () => {
  it("picks the share link out of the text", () => {
    expect(findLoomUrl("Bekijk https://www.loom.com/share/abc123def?sid=1 voor uitleg")).toBe("https://www.loom.com/share/abc123def?sid=1");
    expect(findLoomUrl("geen link")).toBeUndefined();
  });
});

const note = (id: string, updatedAt: number, extra: Partial<BlockNote> = {}): BlockNote => ({ id, blockName: "BLOCK 1", sections: emptySections(), updatedAt, ...extra });

describe("mergeBlockNotes", () => {
  it("newer wins per block, tombstones included", () => {
    const m = mergeBlockNotes({ a: note("a", 2), b: note("b", 5) }, { a: note("a", 3, { loomUrl: "x" }), b: note("b", 4, { deleted: true }) });
    expect(m.a.loomUrl).toBe("x");
    expect(m.b.deleted).toBeUndefined();
  });
});

describe("athleteBlocks", () => {
  it("groups published weeks into blocks and attaches the overlapping note", () => {
    const pub = { "2026-09-07": { blockName: "BLOCK 1" }, "2026-09-14": { blockName: "BLOCK 1" }, "2026-10-26": { blockName: "BLOCK 2" } };
    const notes = { m2: note("m2", 1, { blockName: "BLOCK 2", start: "2026-10-26", end: "2026-11-22" }), m3: note("m3", 1, { blockName: "PEAK", start: "2026-11-23", end: "2026-12-20" }) };
    const blocks = athleteBlocks(pub, notes, addDays);
    expect(blocks.map((b) => b.name)).toEqual(["PEAK", "BLOCK 2", "BLOCK 1"]);
    expect(blocks[1].note?.id).toBe("m2");
    expect(blocks[2].weeks).toBe(2);
    expect(blocks[2].note).toBeUndefined();
  });
});
