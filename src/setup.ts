import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRAINER_MD = path.join(__dirname, "..", "TRAINER.md");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> =>
  new Promise((res) => rl.question(q, (a) => res(a.trim())));

async function main() {
  console.log("\n🏋️  Hevy Trainer — First-time setup\n");
  console.log("Answer a few questions so your trainer knows how to coach you.");
  console.log("Press Enter to skip any question.\n");

  const name = await ask("Your name: ");
  const goal = await ask("Primary goal (e.g. hypertrophy, strength, recomp, fat loss): ");
  const trainingAge = await ask("How long have you been lifting consistently? (e.g. 2 years): ");
  const days = await ask("How many days per week do you train?: ");
  const injuries = await ask("Any injuries or limitations to be aware of?: ");
  const notes = await ask("Anything else your trainer should know about you?: ");

  rl.close();

  // Read existing TRAINER.md
  let content = fs.readFileSync(TRAINER_MD, "utf8");

  // Replace the Profile section values
  const replace = (field: string, value: string) => {
    if (!value) return;
    const regex = new RegExp(`(- \\*\\*${field}:\\*\\*) .*`, "m");
    content = content.replace(regex, `$1 ${value}`);
  };

  replace("Name", name);
  replace("Goal", goal);
  replace("Training age", trainingAge);
  replace("Days per week", days);
  replace("Injuries or limitations", injuries || "none");
  replace("Notes", notes);

  fs.writeFileSync(TRAINER_MD, content, "utf8");

  console.log("\n✅ TRAINER.md updated. Run `npm run start:ollama` to start your trainer.\n");
}

main().catch(console.error);
