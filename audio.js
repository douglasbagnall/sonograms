var wav_1_minute = 'RFPT-WW13-20111229213002-540-60-KR8.wav';
var wav_15_minute = "RFPT-WW10A-2013-02-14T02.00.10-KR5.wav";




function fill_canvas(wav){
    var canvas = document.getElementById('fft');
    var context = canvas.getContext('2d');
    var width = canvas.width;
    var spacing = wav.length / width;
    var window_size = 1024;
    var fft = new FFT(window_size, wav.sampleRate);
    //context.fillRect(50, 25, 150, 100);
    var imgdata = context.createImageData(canvas.width, canvas.height);
    var pixels = imgdata.data;
    var i;
    var left, col;
    var audio = wav.channels[0];
    var mask_window = new Float32Array(window_size);
    var data_window = new Float32Array(window_size);
    var tau_norm = Math.PI * 2 / window_size;
    for (i = 0; i < window_size; i++){
        mask_window[i] = 0.5 - 0.5 * Math.cos(tau_norm * i);
    }

    for (left = 0, col = 0; left + window_size < wav.length; left += spacing, col++){
        var square_window = audio.subarray(left, left + window_size);
        for (i = 0; i < window_size; i++){
            data_window[i] = square_window[i] * mask_window[i];
        }
        fft.forward(data_window);
        var s = fft.spectrum;
        for (i = canvas.height - 1; i >= 0; i--){
            var o = ((canvas.height - i - 1) * width + col) * 4;
            var v = s[i] * s[i] + s[i + 1] * s[i + 1] * 10;
            //pixels[o] = Math.pow(Math.max(v - 1e-7, 0), 0.33) * 1e4;
            pixels[o] = 256 - 1e-4 / (v + 1e-12);
            pixels[o + 1] = Math.sqrt(v) * 1e5;
            pixels[o + 2] = Math.pow(v, 0.25) * 3e3;
            pixels[o + 3] = 255;
        }
        //console.log(col, v, s[200], spacing, pixels[o]);
    }
    context.putImageData(imgdata, 0, 0);
}



function on_page_load() {
    var request = new AudioFileRequest(wav_1_minute);
    request.onSuccess = function(decoded) {
        fill_canvas(decoded);
    };
    request.onFailure = function() {
        alert("bad ");
    };
    request.send();
}

window.addEventListener('load', on_page_load);
