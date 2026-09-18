export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json(
    {
      firebase: {
        apiKey: process.env.FIREBASE_API_KEY || '',
        authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
        projectId: process.env.FIREBASE_PROJECT_ID || '',
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
        appId: process.env.FIREBASE_APP_ID || '',
      },
      teamsMeetingChatUrl: process.env.TEAMS_MEETING_CHAT_URL || '',
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )
}
