import { initializeApp } from "firebase/app"
import { getDatabase, connectDatabaseEmulator } from "firebase/database"

const firebaseConfig = {
  apiKey: "AIzaSyDummy", // not secret — just identifies the project
  projectId: "whitingfamilygames",
  databaseURL: "https://whitingfamilygames-default-rtdb.firebaseio.com",
}

const app = initializeApp(firebaseConfig)
export const database = getDatabase(app)

// Connect to emulator in development
if (import.meta.env.DEV) {
  try {
    connectDatabaseEmulator(database, "127.0.0.1", 9000)
  } catch {
    // already connected
  }
}
