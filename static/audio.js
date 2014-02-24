var audio_context;

function parse_wav(raw){
    /*   https://ccrma.stanford.edu/courses/422/projects/WaveFormat/ */
    var header = new DataView(raw, 0, 44);
    var data = raw.slice(44);
    var i;
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
        //scale = 1.0 / 256;
    }
    else if (bits_per_sample == 16){
        samples = new Int16Array(data);
        //scale = 1.0 / 32768;
    }
    var normalised_samples = new Float32Array(samples.length / channels);

    var sqsum = 0;
    for (i = 0; i < normalised_samples.length; i++){
        var x = samples[i * channels];
        sqsum += x * x;
    }
    scale = 1.0 / Math.sqrt(sqsum / normalised_samples.length);
    for (i = 0; i < normalised_samples.length; i++){
        normalised_samples[i] = samples[i * channels] * scale;
    }
    return {
        samples: normalised_samples,
        samplerate: samplerate,
        duration: normalised_samples.length / samplerate
    };
}

function hann_window(length){
    var i;
    var window = new Float32Array(length);
    var tau_norm = Math.PI * 2 / (length - 1);
    var sum = 0;
    for (i = 0; i < length; i++){
        var x = 0.5 - 0.5 * Math.cos(tau_norm * i);
        window[i] = x;
        sum += x;
    }
    for (i = 0; i < length; i++){
        window[i] /= sum;
    }
    return window;
}

function vorbis_window(length){
    var i;
    var window = new Float32Array(length);
    var pi_norm = Math.PI / (length - 1);
    var half_pi = Math.PI / 2;
    var sum = 0;
    for (i = 0; i < length; i++){
      var z = pi_norm * (i + 0.5);
      var x = Math.sin(half_pi * Math.sin(z) * Math.sin(z));
      window[i] = x;
      sum += x;
    }
    for (i = 0; i < length; i++){
        window[i] /= sum;
    }
    return window;
}

function padded_array(array, radius){
    /*extend the ends via reflection*/
    var padded = new Float32Array(array.length + radius * 2);
    var i;
    for (i = 0; i < array.length; i++){
        padded[radius + i] = array[i];
    }
    for (i = 0; i < radius; i++){
        padded[i] = array[radius - 1 - i];
        padded[array.length + radius + i] = array[array.length - i - 1];
    }
    return padded;
}

function convolve(array, window){
    var radius = parseInt((window.length + 1) / 2);
    var padded = padded_array(array, radius);
    var out = new Float32Array(array.length);
    var i, j;
    for (i = 0; i < array.length; i++){
        var sum = 0;
        for (j = 0; j < window.length; j++){
            sum += padded[i + j] * window[j];
        }
        out[i] = sum;
    }
    return out;
}


function median(original, low, high){
    if (high - low < 2){
        return original[low];
    }
    var array = new Float32Array(original.subarray(low, high));
    var left = 0;
    var right = array.length;
    var k = right >>> 1;
    while (1){
        var pivot = array[right - 1];
        var j = left;
        for (var i = left; i < right; i++){
            var v = array[i];
            if (v < pivot){
                array[i] = array[j];
                array[j] = v;
                j++;
            }
        }
        array[right - 1] = array[j];
        array[j] = pivot;
        var p = j;

        if (k == j){
            return array[k];
        }
        if (k < j){
            right = j;
        }
        else {
            left = j + 1;
        }
    }
}

function running_median(array, radius){
    var out = new Float32Array(array.length);
    var padded = padded_array(array, radius);
    var i;
    for (i = 0; i < array.length; i++){
        out[i] = median(padded, i, i + 2 * radius + 1);
    }
   return out;
}


function calculate_spectrogram(audio, window_size, spacing){
    var i, left, j;
    var fft = new RFFT(window_size, audio.samplerate);
    //var mask_window = hann_window(window_size);
    var mask_window = vorbis_window(window_size);
    var data_window = new Float32Array(window_size);
    var window_padding = 10;
    var height = parseInt(window_size / 2);
    var width = parseInt((audio.samples.length - window_size) / spacing) + 1;
    var spectrogram = new Float32Array(width * height);
    for (j = 0; j < width; j++){
        left = j * spacing;
        var square_window = audio.samples.subarray(left, left + window_size);
        for (i = 0; i < window_size; i++){
            data_window[i] = square_window[i] * mask_window[i];
        }
        fft.forward(data_window);
        spectrogram.set(fft.spectrum, j * height);
    }
    return {
        width: width,
        height: height,
        data: spectrogram,
        windows_per_second: audio.samplerate / spacing,
        band_width: audio.samplerate / window_size,
        duration: audio.duration,
        hz2band: function(x) {
            return parseInt(x / this.band_width);
        }
    };
}


function paint_spectrogram(spectrogram, canvas,
                           row_height,
                           width_in_seconds,
                           low_hz, high_hz, squash){
    var i, j;
    var left, col, row;
    squash = squash || 1;
    var low_band = parseInt(spectrogram.hz2band(low_hz) / squash);
    var high_band = parseInt(spectrogram.hz2band(high_hz) / squash);
    var context = canvas.getContext('2d');
    var imgdata = context.createImageData(canvas.width, canvas.height);
    var pixels = imgdata.data;
    var s_data = spectrogram.data;
    var s_width = spectrogram.width;
    var s_height = spectrogram.height;
    var width = canvas.width;
    var pixel2sec = width_in_seconds / width;
    var height = Math.ceil(s_width / width_in_seconds /
                           spectrogram.windows_per_second) * row_height;
    canvas.height = height;
    var intensity = 0;
    for (j = 0; j < 1000; j++){
        var x = Math.floor(Math.random() * spectrogram.width);
        var y = low_band + Math.floor(Math.random() * (high_band - low_band));
        intensity += s_data[x * spectrogram.height + y];
    }
    var scale = 0.01 / intensity;
    console.log('spectrogram scale, intensity', scale, intensity);

    console.time('paint_spectrogram');
    var pixwidth = width * 4;
    for (j = 0, col = 0, row = 0;
         j < s_width;
         j++, col++){
        var x  = j * s_height;
        var s = s_data.subarray(x, x + s_height);
        var base_offset = ((row * row_height * width + col) * 4  +
                           low_band * pixwidth + (high_band - low_band) * pixwidth);
        for (i = low_band; i < high_band; i++){
            var o = base_offset - i * pixwidth;
            var v2 = s[i * squash] * scale;
            var v = Math.sqrt(v2 + 1e-5);
            var v3 = v2 * v;
            var v4 = v2 * v2;
            pixels[o] = (v2 + v4 * 2e5) * 7e4;
            pixels[o + 1] = (0.2 * v + 70 * v2 + 5e3 * v3) * 7e3;
            pixels[o + 2] = (v - v3 * 1e4 + v4 * 5e6 - v * v4 * 3e8) * 3e3;
            pixels[o + 3] = 255;
        }
        if (col >= width){
            col -= width;
            row++;
        }
    }
    console.log(spectrogram);
    console.timeEnd('paint_spectrogram');
    console.time('putImageData');
    context.putImageData(imgdata, 0, 0);
    console.timeEnd('putImageData');
    return pixels;
}


function fill_canvas(audio, native_audio){
    var fftcanvas = document.getElementById('fft');
    var topcanvas = document.getElementById('drawing');
    var context = fftcanvas.getContext('2d');
    var width = fftcanvas.width;
    var width_in_seconds = 60;

    var pixel2sec = width_in_seconds / width;
    var row_height = 160;
    var height = Math.ceil(audio.samples.length / audio.samplerate /
                           width_in_seconds) * row_height;
    fftcanvas.height = height;
    topcanvas.height = height;
    var audio_source;
    var window_size = 1024;
    var spacing = width_in_seconds * audio.samplerate / width;

    console.time('calculate_spectrogram');
    var spectrogram = calculate_spectrogram(audio, window_size, spacing);
    console.timeEnd('calculate_spectrogram');
    var pixels = paint_spectrogram(spectrogram, fftcanvas, row_height,
                                   width_in_seconds, 550, 1500, 1);

    console.log(spectrogram);

    var LOWER_FREQ = 650;
    var UPPER_FREQ = 1100;

    console.time('detector');
    var moreporks = morepork_detector(spectrogram, LOWER_FREQ, UPPER_FREQ);
    console.timeEnd('detector');

    draw_moreporks(moreporks, row_height, width_in_seconds);


    var drawing = 0;
    var playing_column = 0;
    var playing_row = 0;
    var hidden_data;
    var playing_column_interval;

    function advance_playing_line(){
        context.putImageData(hidden_data, playing_column, playing_row * row_height);
        playing_column++;
        if (playing_column >= width){
            playing_column = 0;
            playing_row++;
        }
        hidden_data = context.getImageData(playing_column, playing_row * row_height,
                                           1, row_height);
        context.fillRect(playing_column, playing_row * row_height, 1, row_height);
    }
    function stop_playing(){
        if (audio_source !== undefined){
            audio_source.stop(0);
        }
        audio_source = undefined;
    }

    function start_playing_at_pos(p){
        stop_playing();
        audio_source = audio_context.createBufferSource();
        audio_source.buffer = native_audio;
        audio_source.connect(audio_context.destination);
        var row = parseInt(p / topcanvas.width);
        var col = parseInt(p % topcanvas.width);
        audio_source.start(0, col * pixel2sec + row * width_in_seconds);
        if (hidden_data !== undefined && playing_column !== undefined){
            context.putImageData(hidden_data, playing_column, playing_row * row_height);
        }
        playing_column = col;
        playing_row = row;
        context.fillStyle = "#ff3";
        hidden_data = context.getImageData(col, row * row_height, 1, row_height);
        context.fillRect(col, row * row_height, 1, row_height);
        playing_column_interval = window.setInterval(advance_playing_line,
                                                     pixel2sec * 1000);
        audio_source.onended = function(id){
            return function(){
                window.clearInterval(id);
            };
        }(playing_column_interval);
    }



    function get_pos(e){
        var position = topcanvas.getBoundingClientRect();
        var x = e.clientX - position.left;
        var y = e.clientY - position.top;
        var row = parseInt(y / row_height);
        var pos =  {
            x: x,
            y: y,
            row: row,
            ry: parseInt(y % row_height),
            pos: row * topcanvas.width + x
        };
        return pos;
    }

    topcanvas.onclick = function(e){
        var p = get_pos(e);
        console.log(p);
        if (p.ry < row_height - 40){
            start_playing_at_pos(p.pos);
        }
        else {
            var m = undefined;
            for (var i = 0; i < moreporks.length; i++){
                var mm = moreporks[i];
                if (p.pos >= mm.left_pix && p.pos <= mm.right_pix){
                    m = mm;
                    break;
                }
            }
            if (m === undefined){
                if (e.ctrlKey){
                    var left = p.pos - 7, right = p.pos + 7;
                    moreporks.push({
                        score: THRESHOLD,
                        left_sec: left * pixel2sec,
                        right_sec: right * pixel2sec,
                        left_pix: left,
                        right_pix: right,
                        selected: 1
                    });
                }
            }
            else if (e.ctrlKey){
                draw_one_morepork(m, row_height, 1);
                m.right_pix++;
                m.right_sec = m.right_pix * pixel2sec;
                draw_one_morepork(m, row_height);
            }
            else if (e.altKey || e.metaKey){
                draw_one_morepork(m, row_height, 1);
                m.right_pix--;
                m.right_sec = m.right_pix * pixel2sec;
                if (m.right_pix - m.left_pix < 5){
                    moreporks.splice(i, 1);
                }
                else{
                    draw_one_morepork(m, row_height);
                }
            }
            else {
                draw_one_morepork(m, row_height, 1);
                m.selected = ! m.selected;
                draw_one_morepork(m, row_height);
            }
        }
        e.preventDefault();
        e.stopPropagation();
    };

    // ondblclick fires after two onclicks. Here it accelerates growing and shrinking, and
    // tries to cancel the default action (selection of the canvas for cut and paste).
    topcanvas.ondblclick = function(e){
        var p = get_pos(e);
        if (p.ry >= row_height - 40){
            var m = undefined;
            for (var i = 0; i < moreporks.length; i++){
                var mm = moreporks[i];
                if (p.pos >= mm.left_pix && p.pos <= mm.right_pix){
                    m = mm;
                    break;
                }
            }
            if (e.ctrlKey){
                draw_one_morepork(m, row_height, 1);
                m.right_pix++;
                m.right_sec = m.right_pix * pixel2sec;
                draw_one_morepork(m, row_height);
            }
            else if (e.altKey || e.metaKey){
                draw_one_morepork(m, row_height, 1);
                m.right_pix--;
                m.right_sec = m.right_pix * pixel2sec;
                if (m.right_pix - m.left_pix < 5){
                    moreporks.splice(i, 1);
                }
                else{
                    draw_one_morepork(m, row_height);
                }
            }
        }
        e.preventDefault();
        e.stopPropagation();
    };


    var drag_start_pos;
    var draggee;
    topcanvas.onmousedown = function(e){
        var p = get_pos(e);
        if (e.shiftKey && p.ry > row_height - 40){
            for (var i = 0; i < moreporks.length; i++){
                var m = moreporks[i];
                if (p.pos >= m.left_pix && p.pos <= m.right_pix){
                    console.log("beginning shift");
                    m.selected = ! m.selected;
                    draw_one_morepork(m, row_height, 1);
                    drag_start_pos = p.pos;
                    draggee = m;
                    break;
                }
            }
        }
        e.preventDefault();
        e.stopPropagation();
    };

    topcanvas.onmouseup = function(e){
        var p = get_pos(e);
        if(drag_start_pos !== undefined){
            console.log("ending shift");
            var d = p.pos - drag_start_pos;
            draggee.left_pix += d;
            draggee.right_pix += d;
            draggee.left_sec = draggee.left_pix * pixel2sec;
            draggee.right_sec = draggee.right_pix * pixel2sec;
            draw_one_morepork(draggee, row_height);
            draggee = undefined;
            drag_start_pos = undefined;
        }
        e.preventDefault();
        e.stopPropagation();
    };

    document.onkeypress = function(e){
        var c = String.fromCharCode(e.charCode);
        if (c == ' ' || c == 'p'){
            if (audio_source === undefined){
                start_playing_at_pos(playing_column + playing_row * topcanvas.width);
            }
            else {
                stop_playing();
            }
            e.preventDefault();
        }
    };
    var save_button = document.getElementById('save-button');
    save_button.onclick = function(e){
        var i;
        var msg = '';
        moreporks.sort(function(a, b){return a.left_pix - b.left_pix});
        for (i = 0; i < moreporks.length; i++){
            var m = moreporks[i];
            if (m.selected){
                msg += m.left_sec.toFixed(2) + ',' + m.right_sec.toFixed(2) + ',';
            }
        }
        document.getElementById('moreporks').value=msg;
        console.log(msg);
        document.getElementById('form').submit();
    };
}


function message(m){
    var el = document.getElementById('message');
    el.innerHTML += "<p>" +  m + "</p>";
}

function load_audio(url) {
    var AudioContext = window.AudioContext || window.webkitAudioContext;
    if (! AudioContext){
        message("Web API seems to be missing from this browser.");
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
                var parsed_audio = parse_wav(wav);
                fill_canvas(parsed_audio, audio);
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
