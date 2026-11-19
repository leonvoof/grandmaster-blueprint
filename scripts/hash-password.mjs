import bcrypt from "bcryptjs";
const password = process.env.GMB_SETUP_PASSWORD;
if (!password) { console.error("Set GMB_SETUP_PASSWORD in your current shell, then rerun."); process.exit(1); }
if (password.length < 14) { console.error("Use at least 14 characters."); process.exit(1); }
console.log(await bcrypt.hash(password, 12));
