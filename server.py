#!/usr/bin/python

import random

from flask import Flask, render_template
app = Flask(__name__)


@app.route('/')
def audio():
    wav = random.choice(['RFPT-WW13-20111229213002-540-60-KR8.wav',
                         'moreporks/RFPT-WWMB-20111208230002-240-60-KR3.wav',
                         'moreporks/RFPT-WW17-20111111220002-0-60-KR4.wav',
                         "RFPT-WW10A-2013-02-14T02.00.10-KR5.wav"])

    return render_template('audio.html', wav=wav)

if __name__ == '__main__':
    if True:
        app.run(debug=True)
    else:
        app.run(host='0.0.0.0')
