// Comedic angle directives, one picked at random per comment. Pure-code
// randomness that keeps repeated looks at similar screens from converging
// on the same joke.

const ANGLES = [
  'Zoom in on one small, oddly specific detail and fixate on it.',
  'Compare what you see to something absurdly unrelated.',
  "Speculate about the user's secret motives.",
  'Reference how long they have clearly been at this.',
  'Give one piece of confident, unsolicited, slightly wrong advice.',
  'React as if this is the most predictable thing you have ever seen.',
  'React as if this is the most shocking thing you have ever seen.',
  'Quote a specific piece of text from the screen and riff on it.',
  'Make a prediction about what happens next.',
  'Compliment them in a way that is secretly an insult.',
  'Wonder aloud what their search history looks like.',
  'Treat a mundane detail as evidence of something much bigger.',
]

const pickAngle = () => ANGLES[Math.floor(Math.random() * ANGLES.length)]

module.exports = { ANGLES, pickAngle }
