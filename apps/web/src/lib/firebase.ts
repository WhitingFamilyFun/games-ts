import { initializeApp } from "firebase/app"
import { getDatabase, connectDatabaseEmulator } from "firebase/database"
import { getAuth, connectAuthEmulator, GoogleAuthProvider } from "firebase/auth"

const firebaseConfig = {
  apiKey: "AIzaSyCjI-Oc8wzYpZ9DT-N-0I3BWqtt_PwUhLQ",
  authDomain: "whitingfamilygames.firebaseapp.com",
  databaseURL: "https://whitingfamilygames-default-rtdb.firebaseio.com",
  projectId: "whitingfamilygames",
  storageBucket: "whitingfamilygames.appspot.com",
  messagingSenderId: "862541469551",
  appId: "1:862541469551:web:d0234afe03cd9ec677fa9a",
}

const app = initializeApp(firebaseConfig)
export const database = getDatabase(app)
export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()

if (import.meta.env.DEV) {
  try {
    connectDatabaseEmulator(database, "127.0.0.1", 9000)
    connectAuthEmulator(auth, "http://127.0.0.1:9099")
  } catch {
    // already connected
  }
}
