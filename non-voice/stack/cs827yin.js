 /* File : cs827yin.js
* Project : Audio Pong
* Licence : MIT
* Author : Nilay Jha
* Date : April - 4 -2020
* Description : Implementation of YIN algorithm 
* for pitch detection from the live media stream of
* microphone using webAudio API
* Code References: 
* 1) YIN-pitch-Tracking by Ashok Fernandez: https://github.com/ashokfernandez/Yin-Pitch-Tracking/blob/master/Yin.c
* 2) Pitchfinder by Peter Hayes: https://github.com/peterkhayes/pitchfinder/blob/master/src/detectors/yin.js
* 3) "Simple Pitch Detector" by Chris Wilson: https://github.com/cwilso/pitchdetect
*/

window.AudioContext = window.AudioContext || window.webkitAudioContext;

var audioContext = null;
var sourceNode = null;
var analyser = null;
var mediaStreamSource = null;
var detectorElem,
	pitchElem,
	noteElem;

var buflen = 1024;
var buf = new Float32Array( buflen );

var noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
window.notes = noteStrings;

window.onload = function() {
	// Initialize the audio context
	audioContext = new AudioContext();
	MAX_SIZE = Math.max(4,Math.floor(audioContext.sampleRate/5000));	// corresponds to a 5kHz signal
	
	// set the canvas for visualization
	detectorElem = document.getElementById( "detector" );
	
	pitchElem = document.getElementById( "pitch" );
	noteElem = document.getElementById( "note" );
}

function error() {
    alert('Stream generation failed.');
}

// get access to the user's microphone
function getUserMedia(callback) {
	dictionary = {};
    try {
		// for cross-browser compatibility
        navigator.getUserMedia = (
			navigator.getUserMedia ||
			navigator.webkitGetUserMedia ||
			navigator.mozGetUserMedia ||
			navigator.msGetUserMedia
		);
		
		// only connect to the input stream from default audioinput
		navigator.mediaDevices.enumerateDevices().then((devices) => {
			devices = devices.filter((d) => d.kind === 'audioinput');
			dictionary['audio'] = {deviceId: devices[0].deviceId}

			// to fix issues with legacy and modern browsers
			if (typeof navigator.mediaDevices.getUserMedia === 'undefined') {
				navigator.getUserMedia(dictionary, callback, error);
			} else {
				navigator.mediaDevices.getUserMedia(dictionary).then(callback).catch(error);
			}
		});
    } catch (e) {
        alert('getUserMedia threw exception :' + e);
    }
}



function gotStream(stream) {
    // Create an AudioNode from the stream.
    mediaStreamSource = audioContext.createMediaStreamSource(stream);

    // Connect it to the destination.
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
	mediaStreamSource.connect( analyser );
	setInterval(function(){ 
		updatePitch("Hello"); }, 60)
}

// function so start capturing input from microphone
function toggleLiveInput() {
    getUserMedia(gotStream);
}

window.toggleit = toggleLiveInput
// function to get pitch from the frequency
function noteFromPitch( frequency ) {
	var noteNum = 12 * (Math.log( frequency / 440 )/Math.log(2) );
	return Math.round( noteNum ) + 69;
}

// get frequency from the note number
function frequencyFromNoteNumber( note ) {
	return 440 * Math.pow(2,(note-69)/12);
}

// get cents of the pitch
function centsOffFromPitch( frequency, note ) {
	return Math.floor( 1200 * Math.log( frequency / frequencyFromNoteNumber( note ))/Math.log(2) );
}

// Implementation of the YIN algorithm
function YIN(float32AudioBuffer, sampleRate) {

	// ################### Initialize the variables ################
	// set default params
	const threshold = 0.05;
	//   const sampleRate = config.sampleRate || DEFAULT_SAMPLE_RATE;
	const probabilityThreshold = 0.05;


	let bufferSize = float32AudioBuffer.length;

	// Set up the yinBuffer as described in step one of the YIN paper.
	const yinBufferLength = bufferSize / 2;
	const yinBuffer = new Float32Array(yinBufferLength);

	let probability, tau;

	for (let t = 0; t < yinBufferLength; t++) {
	yinBuffer[t] = 0;
	}

	// ################### Calculate the difference ################
	// Compute the difference function as described in step 2 of the YIN paper.
	for (let t = 1; t < yinBufferLength; t++) {
	for (let i = 0; i < yinBufferLength; i++) {
		const delta = float32AudioBuffer[i] - float32AudioBuffer[i + t];
		yinBuffer[t] += delta * delta;
	}
	}

	// Compute the cumulative mean normalized difference as described in step 3 of the paper.
	yinBuffer[0] = 1;
	yinBuffer[1] = 1;
	let runningSum = 1;
	for (let t = 2; t < yinBufferLength; t++) {
	runningSum += yinBuffer[t];
	yinBuffer[t] *= t / runningSum;
	}

	// ################### Calculate the absolute difference ################
	// Compute the absolute threshold as described in step 4 of the paper.
	for (tau = 2; tau < yinBufferLength; tau++) {
		if (yinBuffer[tau] < threshold) {
			while (
			tau + 1 < yinBufferLength &&
			yinBuffer[tau + 1] < yinBuffer[tau]
			) {
			tau++;
			}
			// found tau, exit loop and return
			// store the probability
			probability = 1 - yinBuffer[tau];
			break;
		}
	}

	// if no pitch found, return -1.
	if (tau == yinBufferLength || yinBuffer[tau] >= threshold) {
	return -1;
	}

	// If probability too low, return -1.
	if (probability < probabilityThreshold) {
	  return -1;
	}

	// ################### parabolic interpolation ################
	/**
	 * Implements step 5 of the AUBIO_YIN paper. It refines the estimated tau
	 * value using parabolic interpolation. This is needed to detect higher
	 * frequencies more precisely.
	 */
	let betterTau, x0, x2;

	/* Calculate the first polynomial coeffcient based on the current estimate of tau */
	if (tau < 1) {
		x0 = tau;
	} else {
		x0 = tau - 1;
	}

	/* Calculate the second polynomial coeffcient based on the current estimate of tau */
	if (tau + 1 < yinBufferLength) {
		x2 = tau + 1;
	} else {
		x2 = tau;
	}

	/* Algorithm to parabolically interpolate the shift value tau to find a better estimate */
	if (x0 === tau) {
		if (yinBuffer[tau] <= yinBuffer[x2]) {
			betterTau = tau;
		} else {
			betterTau = x2;
		}
	} else if (x2 === tau) {
		if (yinBuffer[tau] <= yinBuffer[x0]) {
			betterTau = tau;
		} else {
			betterTau = x0;
		}
	} else {
		const s0 = yinBuffer[x0];
		const s1 = yinBuffer[tau];
		const s2 = yinBuffer[x2];
		betterTau = tau + (s2 - s0) / (2 * (2 * s1 - s2 - s0));
	}

	// return the estimated pitch value
	return sampleRate / betterTau;

}



// function to update the canvas
// * the pitch information
// * the waveform
function updatePitch( time ) {
	// var cycles = new Array;
	analyser.getFloatTimeDomainData( buf );
	var ac = YIN( buf, audioContext.sampleRate );

	let pitch = null;
	let the_note = null;
	// if -1 is returned by YIN algorithm
 	if (ac == -1) {
 		detectorElem.className = "vague";
	 	pitchElem.innerText = "--";
		noteElem.innerText = "-";
 	} else {
		// if a value greater than -1 is returned
	 	detectorElem.className = "confident";
		pitch = ac;
		if (pitch > 4186) {
			return
		} 
	 	pitchElem.innerText = Math.round( pitch ) ;
		var note =  noteFromPitch( pitch );
		// fixed to deal with undefined values 
		the_note = noteStrings[note%12] || "-";
		// update the pong game controlling function about note change
		// custom events are used for this purpose
		window.dispatchEvent(new CustomEvent('control_player', { detail: { note: the_note } }));
		noteElem.innerHTML = the_note;
	}
}
