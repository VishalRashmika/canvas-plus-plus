import { DiagramRepository } from "../../application/ports/DiagramRepository";
import { FileSystemPort } from "../../application/ports/FileSystemPort";
import { Diagram } from "../../domain/entities/Diagram";
import { Id } from "../../domain/types";
import { JsonCanvasSerializer } from "./JsonCanvasSerializer";

export class FileDiagramRepository implements DiagramRepository {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly resolvePath: (id: Id) => string,
    private readonly serializer: JsonCanvasSerializer = new JsonCanvasSerializer()
  ) {}

  async load(id: Id): Promise<Diagram> {
    const path = this.resolvePath(id);
    const content = await this.fs.readText(path);
    return this.serializer.deserialize(content);
  }

  async save(diagram: Diagram): Promise<void> {
    const path = this.resolvePath(diagram.id);
    const serialized = this.serializer.serialize(diagram, true);
    await this.fs.writeText(path, serialized);
  }

  async exists(id: Id): Promise<boolean> {
    const path = this.resolvePath(id);
    return this.fs.exists(path);
  }

  async delete(id: Id): Promise<void> {
    const path = this.resolvePath(id);
    await this.fs.delete(path);
  }
}
