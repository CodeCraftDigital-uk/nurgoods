import { describe, expect, it } from "vitest";
import { screenProhibited, isProhibitedRow } from "./prohibited";

/**
 * Prohibited category screening must catch adult and sexual products across
 * every field a supplier can use, without blocking ordinary maternity,
 * massage, beauty or wellness products.
 */

const PROHIBITED_TITLES = [
  "Silicone Beaded Anal Plug",
  "Rechargeable Bullet Vibrator for Women",
  "Realistic Silicone Dildo Suction Cup",
  "Male Masturbator Cup Pocket Pussy",
  "Butt Plug Training Set 3 Pieces",
  "Anal Beads Silicone Starter Kit",
  "Penis Enlargement Pump Vacuum Device",
  "Cock Ring Delay Set for Men",
  "BDSM Bondage Restraint Kit",
  "Nipple Clamps with Chain Fetish Play",
  "Prostate Massager Remote Control",
  "Kegel Balls Vaginal Tightening Set",
  "Strap-on Harness Adult Toy",
  "Erotic Couples Pleasure Wand",
  "Personal Lubricant Water Based 100ml",
];

const ALLOWED_TITLES = [
  "Maternity Support Belt for Pregnancy",
  "Deep Tissue Percussion Muscle Massage Gun",
  "Heated Neck and Shoulder Massager",
  "Foot Massager with Shiatsu Rollers",
  "Facial Cleansing Brush and Skincare Device",
  "Breast Pump Electric for Nursing Mothers",
  "Pelvic Floor Exercise Chair Cushion",
  "Hair Removal IPL Device for Women",
  "Silicone Baby Feeding Plate Set",
  "Wooden Desk Organizer Set",
  "Adult Colouring Book Set",
  "Silicone Bath Plug Replacement",
  "Wooden Beads Craft Kit for Adults",
  "Yoga Massage Ball Trigger Point Set",
  "Aromatherapy Massage Oil Lavender",
];

describe("prohibited category screening", () => {
  it.each(PROHIBITED_TITLES)("blocks %s", (title) => {
    const result = screenProhibited({ title });
    expect(result.prohibited).toBe(true);
    expect(result.category).toBe("adult_sexual");
    expect(result.reason).toBeTruthy();
  });

  it.each(ALLOWED_TITLES)("allows %s", (title) => {
    expect(screenProhibited({ title }).prohibited).toBe(false);
  });

  it("reads description, tags, product type and handle, not only the title", () => {
    expect(
      screenProhibited({ title: "Discreet Wellness Device", description: "A vibrator for adult use." })
        .prohibited,
    ).toBe(true);
    expect(screenProhibited({ title: "Comfort Wand", tags: ["home", "sex toys"] }).prohibited).toBe(true);
    expect(screenProhibited({ title: "Relax Kit", productType: "Adult Toys" }).prohibited).toBe(true);
    expect(screenProhibited({ title: "Item 4821", handle: "silicone-anal-plug-black" }).prohibited).toBe(
      true,
    );
  });

  it("requires a sexual qualifier before blocking an ordinary term", () => {
    expect(screenProhibited({ title: "Handheld Massager" }).prohibited).toBe(false);
    expect(
      screenProhibited({ title: "Handheld Massager", description: "For intimate sexual pleasure." })
        .prohibited,
    ).toBe(true);
  });

  it("screens a mirrored store row with snake case fields", () => {
    expect(
      isProhibitedRow({
        title: "Silicone Beaded Anal Plug",
        handle: "silicone-beaded-anal-plug",
        product_type: "Health",
      }),
    ).toBe(true);
    expect(
      isProhibitedRow({ title: "Pregnancy Pillow", product_type: "Maternity", tags: ["maternity"] }),
    ).toBe(false);
  });
});
