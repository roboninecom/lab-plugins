export type RecordingFrame = {
  seq: number
  ts: number
  joints: Record<string, number>
  sensors?: Record<string, number>
  image: string | null
  imageWidth: number | null
  imageHeight: number | null
}

export type SavedEpisode = {
  id: string
  task: string
  success: boolean | null
  frameCount: number
  source: string
  robotModel: string
  recordedAt: number
  frames: RecordingFrame[]
}
