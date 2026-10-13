import { describe, expect, it } from "vitest";
import {
  numberToWords,
  ordinalToWords,
  spellOutEnglish,
  spellOutEnglishSegments,
  yearToWords,
} from "./spell-out-english";

describe("number words", () => {
  it.each([
    [0, "zero"],
    [7, "seven"],
    [15, "fifteen"],
    [42, "forty-two"],
    [100, "one hundred"],
    [1250, "one thousand two hundred fifty"],
    [1_000_000, "one million"],
    [3_000_000_021, "three billion twenty-one"],
  ])("reads %d as %s", (value, words) => {
    expect(numberToWords(value)).toBe(words);
  });

  it.each([
    [1, "first"],
    [2, "second"],
    [3, "third"],
    [12, "twelfth"],
    [20, "twentieth"],
    [22, "twenty-second"],
    [101, "one hundred first"],
  ])("reads ordinal %d as %s", (value, words) => {
    expect(ordinalToWords(value)).toBe(words);
  });

  it.each([
    [1999, "nineteen ninety-nine"],
    [2026, "twenty twenty-six"],
    [2005, "two thousand five"],
    [1900, "nineteen hundred"],
    [1805, "eighteen oh five"],
  ])("reads year %d as %s", (value, words) => {
    expect(yearToWords(value)).toBe(words);
  });
});

describe("spellOutEnglish", () => {
  // Every case gruut handles today, and every case Pocket TTS or gruut gets wrong.
  it.each([
    [
      "I have 3 cats and 1,250 dollars.",
      "I have three cats and one thousand two hundred fifty dollars.",
    ],
    [
      "It costs $5.99, or about €4.",
      "It costs five dollars ninety-nine cents, or about four euros.",
    ],
    ["Just $1 or $0.50 each.", "Just one dollar or fifty cents each."],
    [
      "It sold for £3.20 and ¥500.",
      "It sold for three pounds twenty pence and five hundred yen.",
    ],
    [
      "They raised $2.5M and $3k.",
      "They raised two point five million dollars and three thousand dollars.",
    ],
    [
      "That is 75% done, not 2.5%.",
      "That is seventy-five percent done, not two point five percent.",
    ],
    [
      "Meet me at 3:30 pm on 10/13/2026.",
      "Meet me at three thirty P M on October thirteenth, twenty twenty-six.",
    ],
    ["Come at 3pm or 11 a.m. sharp.", "Come at three P M or eleven A M sharp."],
    [
      "It starts at 9:05 and ends at 10:00.",
      "It starts at nine oh five and ends at ten o'clock.",
    ],
    [
      "The release is on 2026-10-13.",
      "The release is on October thirteenth, twenty twenty-six.",
    ],
    [
      "She came 1st and he came 22nd.",
      "She came first and he came twenty-second.",
    ],
    [
      "In 1999 and 2026 things changed.",
      "In nineteen ninety-nine and twenty twenty-six things changed.",
    ],
    [
      "About 1250 yen, built in 1850.",
      "About one thousand two hundred fifty yen, built in eighteen fifty.",
    ],
    ["Pages 5-10 & 12.", "Pages five to ten and twelve."],
    [
      "Dr. Smith lives on Main St. near St. Louis.",
      "Doctor Smith lives on Main Street near Saint Louis.",
    ],
    ["Mr. and Mrs. Lee, etc.", "Mister and Missus Lee, et cetera."],
    [
      "It is -4 degrees, 72°F outside, -2°C inside.",
      "It is minus four degrees, seventy-two degrees Fahrenheit outside, minus two degrees Celsius inside.",
    ],
    [
      "Email me @ home #4 + 2 = 6.",
      "Email me at home number four plus two equals six.",
    ],
    [
      "Call 555-0123 or (555) 012-3456 now.",
      "Call five five five, zero one two three or five five five, zero one two, three four five six now.",
    ],
    [
      "Version 2.5.1 is out, pi is 3.14.",
      "Version two point five point one is out, pi is three point one four.",
    ],
    [
      "It weighs 3kg and runs 5 km at 10mph.",
      "It weighs three kilograms and runs five kilometers at ten miles per hour.",
    ],
    [
      "I rate it 8/10, half is 1/2, open 24/7.",
      "I rate it eight out of ten, half is one half, open twenty-four seven.",
    ],
    ["I love it 😊 so much! 👍🏽", "I love it so much!"],
    [
      "Wait ~5 minutes, 3 × 4 is 12.",
      "Wait about five minutes, three times four is twelve.",
    ],
    ["#love it *so* much", "hashtag love it so much"],
  ])("spells %j", (text, spoken) => {
    expect(spellOutEnglish(text)).toBe(spoken);
  });

  // Ordinary prose that must read naturally, including review cases.
  it.each([
    ["I'm 25 and in the top 10.", "I'm twenty-five and in the top ten."],
    ["Do it 2-3 times a day.", "Do it two to three times a day."],
    ["COVID-19 changed things.", "COVID-nineteen changed things."],
    ["Get a 5-10% discount.", "Get a five to ten percent discount."],
    ["Save 5%-10% today.", "Save five to ten percent today."],
    [
      "It takes 500-1000 words.",
      "It takes five hundred to one thousand words.",
    ],
    [
      "Eat 200-1500 calories.",
      "Eat two hundred to one thousand five hundred calories.",
    ],
    ["Open 3-4 pm only.", "Open three to four P M only."],
    [
      "From 1999-2005 it grew.",
      "From nineteen ninety-nine to two thousand five it grew.",
    ],
    ["So 5 - 3 = 2.", "So five minus three equals two."],
    ["It costs $5-10.", "It costs five to ten dollars."],
    ["They raised $5 million.", "They raised five million dollars."],
    [
      "Add 5/8 cup, rated 4.5/5.",
      "Add five eighths cup, rated four point five out of five.",
    ],
    [
      "Run 100m, then 5 m more.",
      "Run one hundred meters, then five meters more.",
    ],
    ["The 1990s and '90s.", "The nineteen nineties and nineties."],
    ["It was .5 miles.", "It was point five miles."],
    ["Use 16:9, not 3:2.", "Use sixteen to nine, not three to two."],
    ["I'm on Baker St. See you soon.", "I'm on Baker Street. See you soon."],
    ["Pens, paper, etc. Then we go.", "Pens, paper, et cetera. Then we go."],
    ["Meet at 3 p.m. Bring snacks.", "Meet at three P M. Bring snacks."],
    [
      "Order 12345678901234567890 shipped.",
      "Order one two three four five six seven eight nine zero one two three four five six seven eight nine zero shipped.",
    ],
    ["C++ is fun.", "C plus plus is fun."],
    ["Happy St. Patrick's Day!", "Happy Saint Patrick's Day!"],
    ["Visit St. Louis today.", "Visit Saint Louis today."],
    ["About 5-10,000 people.", "About five to ten thousand people."],
    ["It took 10-15.5 hours.", "It took ten to fifteen point five hours."],
    ["Add 1-2.5 cups.", "Add one to two point five cups."],
    [
      "Prices run $5.99-$9.99 now.",
      "Prices run five dollars ninety-nine cents to nine dollars ninety-nine cents now.",
    ],
    ["It's 555-0123.", "It's five five five, zero one two three."],
    ["Room 555-0123 code", "Room five five five, zero one two three code"],
    [
      "Music from the 80s and 1980s.",
      "Music from the eighties and nineteen eighties.",
    ],
    ["On 3/16 we met, due 5/8.", "On March sixteenth we met, due May eighth."],
    ["Dr. King Jr. Day", "Doctor King Junior Day"],
    ["Rest 60s between sets.", "Rest sixty seconds between sets."],
    [
      "Wait 30s, then go. 20s left!",
      "Wait thirty seconds, then go. twenty seconds left!",
    ],
    ["I love 80s music.", "I love eighties music."],
    ["90s kids remember this.", "nineties kids remember this."],
    ["It was very 80s.", "It was very eighties."],
    ["Classic 60s rock.", "Classic sixties rock."],
    ["80s and 90s fans.", "eighties and nineties fans."],
    [
      "I have a soft spot for 90s anime.",
      "I have a soft spot for nineties anime.",
    ],
    ["Every 90s kid remembers this.", "Every nineties kid remembers this."],
    ["Another 80s classic!", "Another eighties classic!"],
    [
      "Like in 90s anime, dressed in 80s style.",
      "Like in nineties anime, dressed in eighties style.",
    ],
    ["The 90s on MTV were great.", "The nineties on MTV were great."],
    ["I've had 80s on repeat all day.", "I've had eighties on repeat all day."],
    [
      "Hold for 30s. Back in 30s!",
      "Hold for thirty seconds. Back in thirty seconds!",
    ],
    ["Plank for 30s each side.", "Plank for thirty seconds each side."],
    ["Do 20s on, 10s off.", "Do twenty seconds on, ten seconds off."],
    [
      "Rest 45s, then wait 1s.",
      "Rest forty-five seconds, then wait one second.",
    ],
    ["Like in 90s-era anime.", "Like in nineties-era anime."],
    [
      "I'm a sucker for 80s/90s anime.",
      "I'm a sucker for eighties/nineties anime.",
    ],
    ["Hold for 30s—then switch.", "Hold for thirty seconds—then switch."],
    [
      "Hmm...90s? Wait...30s left.",
      "Hmm...nineties? Wait...thirty seconds left.",
    ],
    [
      "In your 20s and the early 90s.",
      "In your twenties and the early nineties.",
    ],
    ["It raised $1-2 million.", "It raised one to two million dollars."],
    [
      "Budgets of $5-$10k each.",
      "Budgets of five to ten thousand dollars each.",
    ],
  ])("reads %j", (text, spoken) => {
    expect(spellOutEnglish(text)).toBe(spoken);
  });

  it("leaves text without numbers or symbols unchanged", () => {
    const text = "Well-known words stay as they are, don't they?";
    expect(spellOutEnglish(text)).toBe(text);
    expect(spellOutEnglishSegments(text)).toEqual([
      { start: 0, end: text.length, text, spelled: false },
    ]);
  });

  it("keeps vocal tags as written", () => {
    expect(spellOutEnglish("Oh my gosh, [laughs] that's 2 funny! <sigh>")).toBe(
      "Oh my gosh, [laughs] that's two funny! <sigh>",
    );
  });
});

describe("spellOutEnglishSegments", () => {
  it("maps each spelled range back to its source", () => {
    const text = "It costs $5.99 today";
    const segments = spellOutEnglishSegments(text);
    expect(segments).toEqual([
      { start: 0, end: 9, text: "It costs ", spelled: false },
      {
        start: 9,
        end: 14,
        text: "five dollars ninety-nine cents",
        spelled: true,
      },
      { start: 14, end: 20, text: " today", spelled: false },
    ]);
    for (const segment of segments.filter((s) => !s.spelled)) {
      expect(text.slice(segment.start, segment.end)).toBe(segment.text);
    }
  });

  it("separates spelled words from adjoining letters", () => {
    expect(spellOutEnglish("Team7wins")).toBe("Team seven wins");
  });
});
