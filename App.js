import { useState, useEffect } from "react";

import * as ImagePicker from "expo-image-picker";
import { Camera } from "expo-camera";
import RegisterAndLogin from "./components/RegisterAndLogin";
import MainContext from './context/MainContext';
import AuthContext from './context/AuthContext';
import Main from "./components/Main";
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { auth, db } from "./firebase";
import { signInWithEmailAndPassword } from "firebase/auth";

import Menu from "./components/Menu";
import * as SecureStore from 'expo-secure-store';
import {  collection, query, where, getDocs, updateDoc, doc, getDoc } from "firebase/firestore";
import * as Clipboard from 'expo-clipboard';
import APItokens from "./tokens/apiKeys";



const Stack = createNativeStackNavigator();

const App = () => {
  const prompt = "You are an AI language model and you have to answer the following question as briefly as possible, providing only the correct answer without any explanations like 'C) Answer text'. Here is the prompt: ";

  //STATES START
  const [isInputCardsVisible, setIsInputCardsVisible] = useState(true);
  const [image, setImage] = useState(null);
  const [googleResponse, setGoogleResponse] = useState("");
  const [chatGPTResponse, setChatGPTResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [count, setCount] = useState(0); 
  const [docId, setDocId] = useState('');
  const [inputCode, setInputCode] = useState("");
  //STATES END
 



  const handleLogin = () => {
    signInWithEmailAndPassword(auth, email, password)
      .then(async (userCredentials) => {
        const user = userCredentials.user;
        setLoading(true);
        console.log("Logged in with:", user.email);
        const userData = {
          email: user.email,
          token: user.refreshToken,
        };
        await SecureStore.setItemAsync("userData", JSON.stringify(userData));
        await SecureStore.setItemAsync("userEmail", user.email);
        const userRef = collection(db, "userData");
        const q = query(userRef, where("email", "==", user.email));
        const querySnapshot = await getDocs(q);
        querySnapshot.forEach((doc) => {
          const firestoreUserData = doc.data();
          setCount(firestoreUserData.count);
        });
        setLoading(false);
      })
      .catch((error) => alert(error.message));
  };
  

  useEffect(() => {
    setLoading(true);
    const restoreUserSession = async () => {
      const userEmail = await SecureStore.getItemAsync("userEmail");
      if (userEmail) {
        setEmail(userEmail);
        const userRef = collection(db, "userData"); 
        const q = query(userRef, where("email", "==", userEmail));
        const querySnapshot = await getDocs(q);
        querySnapshot.forEach((doc) => {
          const userData = doc.data();
          console.log("User session restored. Email:", userData.email, "count:", userData.count);
          setDocId(doc.id); 
          setEmail(userData.email);
          setLoggedIn(true);
          setCount(userData.count);
          setLoading(false);
          }
        );
      }
    };
    restoreUserSession();
  }, []);
  
  const copyToClipboardChatGPTResponse = async () => {
    await Clipboard.setStringAsync(chatGPTResponse);
    alert('Copied!');
  };
  const copyToClipboardQuestion = async () => {
    await Clipboard.setStringAsync(googleResponse.responses[0].fullTextAnnotation.text);
    alert('Copied!');
  };

  const uriToBase64 = async (uri) => {
    const response = await fetch(uri);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const submitToChatGPT = async (question) => {
    try {
      const response = await fetch("https://api.openai.com/v1/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${APItokens.openai}`,
        },
        body: JSON.stringify({
          model: "text-davinci-003",
          temperature: 0.7,
          prompt: prompt + question,
          max_tokens: 500,
          top_p: 1,
        }),
      });
      const data = await response.json();
      console.log(data);
      setChatGPTResponse(data.choices[0].text);
    } catch (error) {
      console.log(error)
    }

  }

  const submitToGoogle = async (base64) => {
    try {
      setLoading(true);
      let body = JSON.stringify({
        requests: [
          {
            features: [{ type: "TEXT_DETECTION", maxResults: 5 }],
            image: {
              content: base64.split(",")[1],
            },
          },
        ],
      });
      let response = await fetch(
        "https://vision.googleapis.com/v1/images:annotate?key=" +
        `${APItokens.googlevision}`,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          method: "POST",
          body: body,
        }
      );
      let responseJson = await response.json();
      console.log(responseJson);
      setGoogleResponse(responseJson);
      setLoading(false);
      submitToChatGPT(responseJson.responses[0].fullTextAnnotation.text);
      console.log(responseJson.responses[0].fullTextAnnotation.text);
      console.log('submittedChatGPT')


      if (
        !responseJson.responses ||
        !responseJson.responses[0].fullTextAnnotation
      ) {
        alert("No text detected", "No text was found in the image.");
      }

    } catch (error) {
      console.log(error);
    }
  };

  const clearPicture = () => {
    setImage(null);
    setIsInputCardsVisible(true);
    setGoogleResponse('');
    setChatGPTResponse('');
    setLoading(false);
  };

  const addAttempt = async () => {
    if (!docId) {
      console.log("User document not found.");
      return;
    }
  
    const userDocRef = doc(db, "userData", docId);
    const userDocSnapshot = await getDoc(userDocRef);
    const userData = userDocSnapshot.data();
    console.log(userData.code,userData.isCodeActive)
  
    if (userData.isCodeActive && userData.code === inputCode) {
      await updateDoc(userDocRef, {
        count: 25, //if user has code give 25 more attemps 
        isCodeActive: false,
      });
      setCount(25);
      alert("Code accepted!");
    } else {
      alert("Invalid code or code is not active.");
    }
  };
  

  const takeAndCropPhoto = async () => {

    if (count > 0) {
      const userDocRef = doc(db, "userData", docId);
      
      
      try {
        const { status } = await Camera.requestCameraPermissionsAsync();
        if (status !== "granted") {
          alert("Sorry, we need camera permissions to make this work!");
          return;
        }
  
  
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect: [5, 3],
          quality: 1,
        });
  
        if (!result.canceled) {
          setImage(result.assets[0].uri);
          const base64 = await uriToBase64(result.assets[0].uri);
          submitToGoogle(base64);
          setIsInputCardsVisible(false);
          await updateDoc(userDocRef, { count: count - 1 });
          setCount(count - 1);
        }
      }
      catch (error) {
        alert(error);
      }
    } else {
      alert("Your 25 attempts are over.\n Contact with Owner.");
    } 
  };

  const pickImage = async () => {
    if (count > 0) {
      const userDocRef = doc(db, "userData", docId);
      
      
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      alert("Sorry, we need camera roll permissions to make this work!");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      MediaTypeOptions: "images",
      aspect: [5, 3],
      quality: 1,
    });

    if (!result.canceled) {
      setImage(result.assets[0].uri);
      const base64 = await uriToBase64(result.assets[0].uri);
      submitToGoogle(base64);
      setIsInputCardsVisible(false);
      await updateDoc(userDocRef, { count: count - 1 });
      setCount(count - 1);
    }
    } else {
      alert("Your 25 attempts are over.");
    }
    
  };

  return (
    <MainContext.Provider value={{ image, googleResponse, loading, chatGPTResponse, isInputCardsVisible, clearPicture, pickImage, takeAndCropPhoto,count,setCount,inputCode,setInputCode,addAttempt,copyToClipboardChatGPTResponse,copyToClipboardQuestion}}>

      <AuthContext.Provider value={{ password, setPassword, email, setEmail, handleLogin, loggedIn, setLoggedIn,loading }}>
        <NavigationContainer>
          <Stack.Navigator
            screenOptions={{
              headerShown: false
            }}
          >
            {loggedIn ? (
              [
                <Stack.Screen key="Main" name="Main" component={Main} />,
                <Stack.Screen key="Menu" name="Menu" component={Menu} />,
              ]
            ) : (
              [
                <Stack.Screen key="Login" name="Login" component={RegisterAndLogin} />,
                <Stack.Screen key="Main" name="Main" component={Main} />,
                <Stack.Screen key="Menu" name="Menu" component={Menu} />,
              ]
            )}


          </Stack.Navigator>
        </NavigationContainer>
      </AuthContext.Provider>
    </MainContext.Provider>



  );
}

export default App;