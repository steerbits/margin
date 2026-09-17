import { dirname, join, resolve } from "node:path";
import {
  DefaultResourceLoader,
  loadProjectContextFiles,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import {
  contextFilenames,
  optionalStat,
  readInstructionText,
} from "./instructions.ts";

type Options = ConstructorParameters<typeof DefaultResourceLoader>[0];
type ContextFile = { path: string; content: string };

function readContext(cwd: string, agentDir: string): ContextFile[] {
  // Validate each effective source strictly before using Pi's discovery. The
  // latter retains Pi's ordering, deduplication and nested-worktree shadowing,
  // but normally warns and omits unreadable sources, which isn't safe after Save.
  const directories = new Set([resolve(agentDir)]);
  let directory = resolve(cwd);
  while (true) {
    directories.add(directory);
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const contents = new Map<string, string>();
  for (const dir of directories) {
    for (const name of contextFilenames) {
      const path = join(dir, name);
      if (!optionalStat(path)?.isFile()) continue;
      contents.set(path, readInstructionText(path).replace(/^\uFEFF/, ""));
      break;
    }
  }
  return loadProjectContextFiles({ cwd, agentDir }).map(({ path }) => {
    if (!contents.has(path))
      throw new Error(
        `Instructions changed while loading: ${path}. Retry your message.`,
      );
    return { path, content: contents.get(path)! };
  });
}

/** Refresh context only, never extensions, settings, models, skills or history. */
export class InstructionResourceLoader extends DefaultResourceLoader {
  private current?: ContextFile[];
  private readonly instructionCwd: string;
  private readonly instructionAgentDir: string;
  constructor(options: Options) {
    super({
      ...options,
      agentsFilesOverride: () => ({
        agentsFiles: readContext(options.cwd, options.agentDir),
      }),
    });
    this.instructionCwd = options.cwd;
    this.instructionAgentDir = options.agentDir;
  }
  override getAgentsFiles() {
    return this.current
      ? { agentsFiles: this.current }
      : super.getAgentsFiles();
  }
  override async reload(
    options?: Parameters<DefaultResourceLoader["reload"]>[0],
  ) {
    await super.reload(options);
    this.current = undefined;
  }
  refreshInstructions(session: AgentSession) {
    if (session.isStreaming || session.isCompacting)
      throw new Error(
        "Wait for the current response to finish before updating instructions.",
      );
    try {
      const next = readContext(this.instructionCwd, this.instructionAgentDir);
      if (
        JSON.stringify(next) ===
        JSON.stringify(this.getAgentsFiles().agentsFiles)
      )
        return;
      const previous = this.current;
      this.current = next;
      try {
        // Public SDK API rebuilds the base prompt from the loader while retaining
        // the registered, selected tools. No reload hooks or session replacement.
        session.setActiveToolsByName(session.getActiveToolNames());
      } catch (error) {
        this.current = previous;
        throw error;
      }
    } catch (error) {
      throw new Error(
        `Couldn't load updated instructions. Your message has not been sent. Retry after fixing the file. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
