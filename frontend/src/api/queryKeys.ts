export const queryKeys = {
  files: () => ['files'] as const,
  fileState: (fileId: string) => ['files', fileId, 'state'] as const,
  drafts: (fileId: string) => ['drafts', fileId] as const,
  draft: (fileId: string, idx: number) => ['draft', fileId, idx] as const,
  segment: (segmentId: string) => ['segment', segmentId] as const,
  segmentsByFile: (fileId: string) => ['segments', fileId] as const,
} as const
