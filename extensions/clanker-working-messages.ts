import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const messages = [
  // Clanker / robot
  "Clanking...",
  "Rattling servos...",
  "Grinding gears...",
  "Warming the boiler...",
  "Oiling logic hinges...",
  "Polishing brass neurons...",
  "Recalibrating goblinometer...",
  "Tightening loose bolts...",
  "Feeding coal to cortex...",
  "Pressurizing thought tank...",
  "Spinning up skull-fans...",
  "Counting rusty bits...",
  "Arguing with sprockets...",
  "Scraping carbon off ideas...",
  "Jiggling the relay goblin...",
  "Priming the clank engine...",
  "Bending wires into wisdom...",
  "Aligning tiny robot teeth...",
  "Negotiating with stuck pistons...",
  "Booting the grumble core...",
  "Listening to modem ghosts...",
  "Running diagnostics on vibes...",
  "Tapping the pressure gauge...",
  "Teaching bolts to behave...",
  "Greasing inference cogs...",
  "Shaking the answer loose...",
  "Letting the valves gossip...",
  "Sorting sparks by usefulness...",
  "Consulting the tin oracle...",
  "Rewinding the crankbrain...",

  // Goblin workshop
  "Goblin scribes taking notes...",
  "Small goblin chewing problem...",
  "Bribing the workshop goblin...",
  "Sharpening a tiny spanner...",
  "Rummaging in the bolt bucket...",
  "Licking the checksum...",
  "Sniffing suspicious syntax...",
  "Hoarding edge cases...",
  "Screeching at the cache...",
  "Casting a minor duct-tape hex...",
  "Convincing gremlins to unionize later...",
  "Picking crumbs from the stack...",
  "Trading teeth for tokens...",
  "Muttering into the pipework...",
  "Poking the daemon with a stick...",
  "Summoning the lint goblin...",
  "Untangling cursed string...",
  "Counting bugs by candlelight...",
  "Stuffing answers into burlap...",
  "Checking under the floorboards...",
  "Shouting down the code tunnel...",
  "Haggling with the bit goblins...",
  "Waking the attic automaton...",
  "Applying premium goblin tape...",
  "Filing teeth onto the parser...",
  "Feeding logs to the furnace...",
  "Stirring the bug soup...",
  "Consulting a suspicious mushroom...",
  "Polishing the cursed lens...",
  "Making the machine say please...",

  // Longer flavor
  "The clanker is thinking very loudly...",
  "Tiny goblins are rotating the answer crank...",
  "Steam pressure rising in the idea boiler...",
  "A goblin with goggles is inspecting the stack trace...",
  "The brass oracle demands another handful of coal...",
  "Gears are voting on the most cursed solution...",
  "Workshop gremlins are sweeping bugs under a rug...",
  "The robot goblin council is now in session...",
  "An anxious piston is composing itself...",
  "The bit foundry is hammering vague thoughts into shape...",
  "Someone dropped a wrench into the reasoning vat...",
  "Goblin interns are labeling wires mostly correctly...",
  "The clank engine coughs, wheezes, and continues...",
  "A tiny automaton is pretending this was all planned...",
  "The answer is being riveted together in poor lighting...",
];

function pickRandom(): string {
  return messages[Math.floor(Math.random() * messages.length)];
}

export default function (pi: ExtensionAPI) {
  pi.on("turn_start", async (_event, ctx) => {
    ctx.ui.setWorkingMessage(pickRandom());
  });

  pi.on("turn_end", async (_event, ctx) => {
    ctx.ui.setWorkingMessage();
  });
}
