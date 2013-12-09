var wav_1_minute = 'RFPT-WW13-20111229213002-540-60-KR8.wav';
var wav_15_minute = "RFPT-WW10A-2013-02-14T02.00.10-KR5.wav";
var URL = wav_1_minute;

var COLOUR_LUT = {
    k: "#0ff",
    m: "#f00",
    f: "#0f0",
    e: "#000"
};

var audio_context;

function parse_wav(raw){
    /*   https://ccrma.stanford.edu/courses/422/projects/WaveFormat/ */
    var header = new DataView(raw, 0, 44);
    var data = raw.slice(44);
    if (header.getUint32(0, 0) != 0x52494646 || //'RIFF'
        header.getUint32(8, 0) != 0x57415645 || //'WAVE'
        header.getUint16(20, 1) != 1         || //format (pcm == 1)
        header.getUint32(40, 1) != data.byteLength  //length should match data
       ){
       message("I can't understand this file. Is it really a WAV?" +
               " (Continuing regardless...)");
       console.log(header.getUint32(0, 0), 0x52494646,
       header.getUint32(8, 0), 0x57415645,
       header.getUint16(16, 1), 1,
       header.getUint32(40, 1), data.byteLength);
    }
    var samplerate = header.getUint32(24, 1);
    /*if there are more than one channel, just silently grab the first one */
    var channels = header.getUint16(22, 1);
    var bits_per_sample = header.getUint16(34, 1);
    var samples, scale;
    if (bits_per_sample == 8){
        samples = new Int8Array(data);
        scale = 1.0 / 256;
    }
    else if (bits_per_sample == 16){
        samples = new Int16Array(data);
        scale = 1.0 / 32768;
    }
    var normalised_samples = new Float32Array(samples.length / channels);
    for (var i = 0; i < normalised_samples.length; i++){
        normalised_samples[i] = samples[i * channels] * scale;
    }
    return {
        audio: normalised_samples,
        samplerate: samplerate
    };
}


function fill_canvas(audio, samplerate, native_audio){
    var canvas = document.getElementById('fft');
    var context = canvas.getContext('2d');
    var width = canvas.width;
    var spacing = audio.length / width;
    var pixel2sec = native_audio.duration / width;
    var audio_source;
    var window_size = 1024;
    var fft = new FFT(window_size, samplerate);
    //context.fillRect(50, 25, 150, 100);
    var imgdata = context.createImageData(canvas.width, canvas.height);
    var pixels = imgdata.data;
    var i;
    var left, col;
    var mask_window = new Float32Array(window_size);
    var data_window = new Float32Array(window_size);
    var tau_norm = Math.PI * 2 / window_size;
    for (i = 0; i < window_size; i++){
        mask_window[i] = 0.5 - 0.5 * Math.cos(tau_norm * i);
    }

    for (left = 0, col = 0; left + window_size < audio.length; left += spacing, col++){
        var square_window = audio.subarray(left, left + window_size);
        for (i = 0; i < window_size; i++){
            data_window[i] = square_window[i] * mask_window[i];
        }
        fft.forward(data_window);
        var s = fft.spectrum;
        for (i = canvas.height - 1; i >= 0; i--){
            var o = ((canvas.height - i - 1) * width + col) * 4;
            var v = s[i] * s[i] + s[i + 1] * s[i + 1];
            pixels[o] = v * 3e8;
            pixels[o + 1] = Math.sqrt(v) * 1e5;
            pixels[o + 2] = Math.pow(v, 0.25) * 1e3;
            pixels[o + 3] = 255;
        }
        //console.log(col, v, s[200], spacing, pixels[o]);
    }
    context.putImageData(imgdata, 0, 0);
    function refill_background(){
        var data = context.getImageData(0, 0, canvas.width, canvas.height);
        var pix = data.data;
        for (i = 0; i < 4 * canvas.width * canvas.height; i += 4){
            if (pix[i] == 0 && pix[i + 1] == 0 && pix[i + 2] == 0){
                pix[i] = pixels[i];
                pix[i + 1] = pixels[i + 1];
                pix[i + 2] = pixels[i + 2];
            }
        }
        context.putImageData(data, 0, 0);
    }
    var drawing = 0;
    var colour = COLOUR_LUT['m'];
    var colour_label = document.getElementById("colour-m");
    colour_label.style.background = "#fc0";
    function switch_colour(c){
        if (colour === '#000'){
            refill_background();
        }
        var new_colour = COLOUR_LUT[c];
        if (new_colour !== undefined){
            colour_label.style.background = "#fff";
            colour_label = document.getElementById("colour-" + c);
            colour_label.style.background = "#fc4";
            colour = new_colour;
        }
    }

    for (var c in COLOUR_LUT){
        var label = document.getElementById("colour-" + c);
        label.onclick = function(x){
            return function(){switch_colour(x);};
        }(c);
    }
    canvas.onclick = function(e){
        if (e.shiftKey){
            var x = e.pageX - this.offsetLeft;
            if (audio_source){
                audio_source.stop(0);
            }
            console.log(x * pixel2sec);
            /*audio_source.onended = function(){
                audio_source = undefined;
            };*/
            audio_source = audio_context.createBufferSource();
            audio_source.buffer = native_audio;
            audio_source.connect(audio_context.destination);
            audio_source.start(0, x * pixel2sec);
        }
    };

    function draw_to(x, y, colour){
        context.lineTo(x, y);
        context.stroke();
    }
    canvas.onmousedown = function(e){
        if (! e.shiftKey){
            drawing = 1;
            var x = e.pageX - this.offsetLeft;
            var y = e.pageY - this.offsetTop;
            context.beginPath();
            context.lineWidth = 5;
	    context.lineJoin = 'round';
            context.strokeStyle = colour;
            context.moveTo(x, y);
            draw_to(x, y);
        }
    };
    document.onmouseup = function(e){
        drawing = 0;
    };
    canvas.onmousemove = function(e){
        if (drawing){
            draw_to(e.pageX - this.offsetLeft,
                    e.pageY - this.offsetTop);
        }
    };
    document.onkeypress = function(e){
        var c = String.fromCharCode(e.charCode);
        switch_colour(c);
    };
}


function message(m){
    var el = document.getElementById('message');
    el.innerHTML += "<p>" +  m + "</p>";
}

function load_audio(url) {
    var AudioContext = window.AudioContext || window.webkitAudioContext;
    if (! AudioContext){
        message("Web API seems to be missing from this browser.<br>" +
               "It could almost work like that, but I can't be bothered" +
               " maintaining it. Expect errors. Sorry!");
    }
    /*audio_context is global*/
    audio_context = new AudioContext();
    var request = new XMLHttpRequest();
    request.open('GET', url, true);
    request.responseType = 'arraybuffer';
    request.onload = function(){
        var wav = request.response;
        audio_context.decodeAudioData(wav,
            function(audio) {
                var norm = parse_wav(wav);
                fill_canvas(norm.audio, norm.samplerate, audio);
            });
    };
    request.send();
}

function on_page_load() {
    if (document.location.protocol == 'file:'){
        message("<b>Warning:</b> this probably won't work from the local filesystem " +
                "(<tt>file://</tt> protocol), due to browser security settings. " +
                "<br>Use a local webserver, like webfsd.");
    }
    load_audio(URL);
}

window.addEventListener('load', on_page_load);
