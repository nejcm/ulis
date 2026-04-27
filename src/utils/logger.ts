const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

export const logger = {
  info: (msg: string) => console.log(`${CYAN}[info]${RESET} ${msg}`),
  success: (msg: string) => console.log(`${GREEN}[done]${RESET} ${msg}`),
  warn: (msg: string) => console.log(`${YELLOW}[warn]${RESET} ${msg}`),
  error: (msg: string) => console.error(`${RED}[error]${RESET} ${msg}`),
  dim: (msg: string) => console.log(`${DIM}${msg}${RESET}`),
  header: (msg: string) => console.log(`\n${CYAN}━━━ ${msg} ━━━${RESET}`),
};
