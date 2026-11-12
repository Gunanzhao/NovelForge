import type {
CopyNodeInput,
DocumentData,
MoveNodeInput,
NodeInput,
ProjectData,
SaveDocumentInput,
} from '../types'
import { command,isDesktop } from './transport'

export const manuscriptApi = {
  importManuscript: (
    input: import('../manuscript-import').ImportManuscriptInput,
  ) => command<ProjectData>('import_manuscript', { input }),
  createNode: (input: NodeInput) =>
    command<ProjectData>('create_node', { input }),
  renameNode: async (input: {
    projectPath: string
    nodeId: string
    title: string
    expectedContent?: string
  }): Promise<ProjectData & { renamedDocument?: DocumentData }> => {
    if (!isDesktop) {
      const data = await command<ProjectData>('rename_node', { input })
      const renamedDocument =
        data.nodes.find((node) => node.id === input.nodeId)?.kind !== 'volume'
          ? await command<DocumentData>('get_document', { input })
          : undefined
      return { ...data, renamedDocument }
    }
    const result = await command<{
      data: ProjectData
      document: DocumentData | null
    }>(
      'rename_node_checked',
      { input, expectedContent: input.expectedContent },
      'desktopOnly',
    )
    return { ...result.data, renamedDocument: result.document ?? undefined }
  },
  setNodeStatus: (input: {
    projectPath: string
    nodeId: string
    status: string
  }) => command<ProjectData>('set_node_status', { input }),
  reorderNode: (input: {
    projectPath: string
    nodeId: string
    direction: string
  }) => command<ProjectData>('reorder_node', { input }),
  moveNode: (input: MoveNodeInput) =>
    command<ProjectData>('move_node', { input }),
  copyNode: (input: CopyNodeInput) =>
    command<ProjectData>('copy_node', { input }),
  deleteNode: (input: { projectPath: string; nodeId: string }) =>
    command<ProjectData>('delete_node', { input }),
  getDocument: (input: { projectPath: string; nodeId: string }) =>
    command<DocumentData>('get_document', { input }),
  saveDocument: (
    input: SaveDocumentInput & {
      expectedContent?: string
      annotationAnchors?: import('../types').AnnotationAnchor[]
    },
  ) =>
    isDesktop
      ? command<DocumentData>(
          'save_document_annotated',
          {
            input,
            expectedContent: input.expectedContent ?? input.content,
            annotationAnchors: input.annotationAnchors,
          },
          'desktopOnly',
        )
      : command<DocumentData>('save_document', { input }),
}
