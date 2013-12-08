var wav_1_minute = 'RFPT-WW13-20111229213002-540-60-KR8.wav';
var wav_15_minute = "RFPT-WW10A-2013-02-14T02.00.10-KR5.wav";

var COLOUR_LUT = {
    k: "#0ff",
    m: "#f00",
    f: "#0f0",
    e: "#000"
};

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
            //pixels[o] = 255 - 1e-4 / (v * + 1e-9);
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

    function draw_to(x, y, colour){
        context.lineTo(x, y);
        context.stroke();
    }
    canvas.onmousedown = function(e){
        drawing = 1;
        var x = e.pageX - this.offsetLeft;
        var y = e.pageY - this.offsetTop;
        context.beginPath();
        context.lineWidth = 5;
	context.lineJoin = 'round';
        context.strokeStyle = colour;
        context.moveTo(x, y);
        draw_to(x, y);
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

function on_page_load() {
    if (document.location.protocol == 'file:'){
        message("<b>Warning:</b> this probably won't work from the local filesystem " +
                "(<tt>file://</tt> protocol), due to browser security settings. " +
                "<br>Use a local webserver, like webfsd.");
    }
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
