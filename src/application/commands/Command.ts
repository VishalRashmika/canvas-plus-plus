export interface Command {
  readonly description: string;
  execute(): void;
  undo(): void;
}
