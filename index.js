$(function() {

  // Some useful globals
  var showCarryingCapacity = false;
  var showSlopeLine = false;
  var timeIsAnimating = false;
  var viewportBuffer = 1.1;

  // Set up the canvas
  var canvas = $('#population-sketch')[0];
  var ctx = canvas.getContext('2d');
  var w = canvas.width;
  var h = canvas.height;

  // Initialize the r-calculation popup
  $('#calculate-r').popup({
    popup: $('#r-calculation'),
    on: 'click',
    position: 'left center'
  });

  // Initialize the settings menu
  $('#settings').popup({
    popup: $('#bounds'),
    on: 'click',
    position: 'bottom right'
  });

  // Cache some DOM collections
  var $nInput = $('#n-input'),
      $rInput = $('#r-input'),
      $kInput = $('#k-input'),
      $tInput = $('#t-input'),
      $nMin = $('#n-min'),
      $nMax = $('#n-max'),
      $rMin = $('#r-min'),
      $rMax = $('#r-max'),
      $kMin = $('#k-min'),
      $kMax = $('#k-max'),
      $tMin = $('#t-min'),
      $tMax = $('#t-max'),
      $showCapacity = $('#show-capacity'),
      $showSlope = $('#show-slope'),
      $slopeValue = $('#slope-value'),
      $births = $('#births'),
      $deaths = $('#deaths'),
      $immigration = $('#immigration'),
      $emigration = $('#emigration'),
      $popValue = $('#nt-value')
      $animation = $('#animation');

  // Initialize the r calculator
  $births.val(0);
  $deaths.val(0);
  $immigration.val(0);
  $emigration.val(0);

  // Initialize the bounds settings menu
  $nMin.val(0);
  $nMax.val(1500);
  $kMin.val(0);
  $kMax.val(1500);
  $rMin.val(0);
  $rMax.val(2);
  $tMin.val(0);
  $tMax.val(10);

  // set up the calculator
  var elt = $('#calculator')[0];
  var opts = {
    expressions: false,
    settingsMenu: false,
    zoomButtons: false,
    border: false,
    lockViewport: true
  };
  var calc = Desmos.GraphingCalculator(elt, opts);

  // MathQuill setup
  var MQ = Desmos.MathQuill;
  MQ.StaticMath($('#n-label')[0]);
  MQ.StaticMath($('#k-label')[0]);
  MQ.StaticMath($('#r-label')[0]);
  MQ.StaticMath($('#t-label')[0]);
  MQ.StaticMath($('#nt-label')[0]);

  // Create some sliders
  var rScrubber = new ScrubberView();
  var nScrubber = new ScrubberView();
  var kScrubber = new ScrubberView();
  var tScrubber = new ScrubberView();

  // Helpers
  function getStep(min, max) {
    return (max - min) / 150; // slider is 150px wide
  }

  function clampValue(slider) {
    if (slider.value() < slider.min()) slider.value(slider.min());
    if (slider.value() > slider.max()) slider.value(slider.max());
  }

  // A member of the population. I mean, a dot.
  function Member(x, y) {
    this.x = Math.random() *  w;
    this.y = Math.random() * h;
    this.r = w / 40;
    this.color = '#2d70b3';
  }

  Member.prototype.render = function() {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, this.r, 0, 2*Math.PI);
    ctx.fillStyle = this.color;
    ctx.globalAlpha = 0.5;
    ctx.fill();
  };

  // Keep track of the population and rendering
  function Population(size) {
    this.members = [];
    for (var i=0; i<size; i++) {
      this.members.push(new Member());
    }
    this.draw();
  }

  Population.prototype.draw = function() {
    ctx.clearRect(0, 0, w, h);
    this.members.forEach(function(elt) {
      elt.render();
    });
  };

  Population.prototype.setSize = function(size) {
    // Don't try to create too many dots
    size = Math.min(size, 5000);
    var currentSize = this.members.length;
    if (size === currentSize) return;
    if (size < currentSize) {
      this.members = this.members.slice(0, size);
    }
    if (size > currentSize) {
      while (this.members.length < size) this.members.push(new Member());
    }
    window.requestAnimationFrame(this.draw.bind(this));
  };

  // The overall model
  function Model(opts) {
    this.initialPopulation = opts.initialPopulation;
    this.rate = opts.rate;
    this.capacity = opts.capacity;

    this.minPopulation = opts.minPopulation;
    this.maxPopulation = opts.maxPopulation;
    this.minRate = opts.minRate;
    this.maxRate = opts.maxRate;
    this.minCapacity = opts.minCapacity;
    this.maxCapacity = opts.maxPopulation;
    this.maxTime = opts.maxTime;

    this.init();
  }

  Model.prototype.init = function() {
    this.population = new Population(this.initialPopulation);
    this.computeSteps();

    // Set up the initial calculator state
    calc.setExpressions([
      { id: 'N_0', latex: 'N_0=' + this.initialPopulation },
      { id: 'r', latex: 'r=' + this.rate, hidden: true },
      { id: 'k', latex: 'k=' + this.capacity, },
      { id: 'T', latex: 'T=0' },
      { id: 'P', latex: 'P=N(T)', hidden: true },
      { id: 'm', latex: 'm=N\'(T)' },
      { id: 'time-point', latex: '(T, N(T))', color: Desmos.Colors.RED },
      {
        id: 'curve',
        latex: 'N\\left(t\\right)=\\frac{kN_0e^{rt}}{k+N_0\\left(e^{rt}-1\\right)}\\left\\{t\\ge 0\\right\\}',
        color: Desmos.Colors.RED
      },
      {
        id: 'capacity-line',
        latex: 'y=k\\left\\{x\\ge 0\\}',
        color: Desmos.Colors.BLACK,
        hidden: true
      },
      {
        id: 'slope-line',
        latex: 'y-N(T) = m(x-T)',
        color: Desmos.Colors.BLUE,
        hidden: true
      }
    ]);
    this.updateBounds();
  };

  Model.prototype.computeSteps = function() {
    this.populationStep = getStep(this.minPopulation, this.maxPopulation);
    this.rateStep = getStep(this.minRate, this.maxRate);
    this.capacityStep = getStep(this.minCapacity, this.maxCapacity);
    this.timeStep = getStep(0, this.maxTime);
  };

  Model.prototype.setInitialPopulation = function(newPop) {
    this.initialPopulation = newPop;
    calc.setExpression({ id: 'N_0', latex: 'N_0=' + newPop });
  };

  Model.prototype.setRate = function(newRate) {
    if (newRate < this.minRate) {
      this.minRate = newRate;
      rScrubber.min(newRate.toFixed(2));
      clampValue(rScrubber);
      this.computeSteps();
    }
    if (newRate > this.maxRate) {
      this.maxRate = newRate;
      rScrubber.max(newRate.toFixed(2));
      clampValue(rScrubber);
      this.computeSteps();
    }
    this.rate = newRate;
    calc.setExpression({ id: 'r', latex:  'r=' + newRate });
  };

  Model.prototype.setCapacity = function(newCapacity) {
    this.capacity = newCapacity;
    calc.setExpression({ id: 'k', latex: 'k=' + newCapacity });
  };

  Model.prototype.updateBounds = function() {
    var xmax = this.maxTime * viewportBuffer;
    var xmin = this.maxTime * (1 - viewportBuffer)
    var ymax = this.maxCapacity * viewportBuffer;
    var ymin = this.maxCapacity * (1 - viewportBuffer)
    calc.setMathBounds({ left: xmin, right: xmax, bottom: ymin, top: ymax });
  }

  // Set the model's initialPopulation, rate, and capacity.
  // For instance, if you wanted to set from a saved state.
  Model.prototype.setParameters = function(newParams) {
    if (
      newParams === undefined ||
      newParams.initialPopulation === undefined ||
      newParams.rate === undefined ||
      newParams.capacity === undefined ||
      newparams.minPopulation === undefined ||
      newparams.maxPopulation === undefined ||
      newparams.minRate === undefined ||
      newparams.maxRate === undefined ||
      newparams.minCapacity === undefined ||
      newparams.maxCapacity === undefined ||
      newparams.maxTime === undefined
    ) {
      throw new Error(
        '\nYou must pass in an object with the following properties:\n' +
        'initialPopulation\n' +
        'rate\n' +
        'capacity\n' +
        'minPopulation\n' +
        'maxPopulation\n' +
        'minRate\n' +
        'maxRate\n' +
        'minCapacity\n' +
        'maxCapacity\n' +
        'maxTime'
      );
    } 

    this.setInitialPopulation(newParams.initialPopulation);
    this.setRate(newParams.rate);
    this.setCapacity(newParams.capacity);
    this.minPopulation = newParams.minPopulation;
    this.maxPopulation = newParams.maxPopulation;
    this.minRate = newParams.minRate;
    this.maxRate = newParams.maxRate;
    this.minCapacity = newParams.minCapacity;
    this.maxCapacity = newParams.maxPopulation;
    this.maxTime = newParams.maxTime;

    this.computeSteps();
    this.udpateBounds();
  };

  // Get the current model parameters. For instance, if you want to persist them.
  Model.prototype.getParameters = function() {
    return {
      initialPopulation: this.initialPopulation,
      rate: this.rate,
      capacity: this.capacity,
      minPopulation: this.minPopulation,
      maxPopulation: this.maxPopulation,
      minRate: this.minRate,
      maxRate: this.maxRate,
      minCapacity: this.minCapacity,
      maxCapacity: this.maxPopulation,
      maxTime: this.maxTime
    };
  };

  // Attach the model to the window object so that you can, e.g. get and set
  // the model parameters from another script
  window.model = new Model({
    initialPopulation: 100,
    minPopulation: 0,
    maxPopulation: 1500,
    rate: 0.6,
    minRate: 0,
    maxRate: 2,
    capacity: 1000,
    minCapacity: 0,
    maxCapacity: 1500,
    maxTime: 10
  });


  // Listen to some important calculator values
  var P = calc.HelperExpression({ latex: 'P' });
  P.observe('numericValue', function() {
    var currentPop = Math.round(P.numericValue);
    model.population.setSize(currentPop);
    $popValue.text(currentPop);
  });

  var T = calc.HelperExpression({ latex: 'T' });

  function animationTimeout() {
    clearTimeout(animationTimeout);
    if (!timeIsAnimating) return;
    var newTime = T.numericValue + model.timeStep;
    if (newTime > model.maxTime) newTime = 0;
    calc.setExpression({id: 'T', latex: 'T=' + newTime });
    setTimeout(animationTimeout, 1000/60);
  }

  $animation.click(function() {
    $animation.toggleClass('play').toggleClass('pause');
    timeIsAnimating = $animation.hasClass('pause');
    $animation.text(timeIsAnimating ? 'Pause' : 'Play');
    animationTimeout();
  });

  var m = calc.HelperExpression({ latex: 'm' });
  m.observe('numericValue', function() {
    $slopeValue.text(m.numericValue.toFixed(2));
  });

  var r = calc.HelperExpression({ latex: 'r' });
  var n = calc.HelperExpression({ latex: 'N_0' });
  var k = calc.HelperExpression({ latex: 'k' });

  // Show/hide the carrying capacity
  $showCapacity.click(function() {
    showCarryingCapacity = !showCarryingCapacity;
    calc.setExpression({ id: 'capacity-line', hidden: !showCarryingCapacity });
    $showCapacity.text(showCarryingCapacity ? 'Hide' : 'Show');
  });

  $showSlope.click(function() {
    showSlopeLine = !showSlopeLine;
    calc.setExpression({ id: 'slope-line', hidden: !showSlopeLine });
    $showSlope.text(showSlopeLine ? 'Hide' : 'Show');
  });

  // Calculate and set r based on birth/death and immigration/emigration info
  function setRateFromData() {
    var b = $births.val(),
        d = $deaths.val(),
        i = $immigration.val(),
        e = $emigration.val();

    var rate = ( (b-d) + (i-e) );
    model.setRate(rate);
  }

  [$births, $deaths, $immigration, $emigration].forEach(function(elt) {
    elt.on('change', function() {
      if (isNaN(elt.val())) elt.val(0);
      setRateFromData();
    });
  });

  // Clear the r-calculator inputs
  $('#clear-r').click(function() {
    $('.r-input').val(0);
  });

  // Set up sliders and keep them in sync with the inputs/calculator
  nScrubber.min(0).max(1500).value(model.initialPopulation).step(10);
  nScrubber.onValueChanged = function(val) {
    $nInput.val(val);
    model.setInitialPopulation(val);
  };
  nScrubber.elt.style.width = '150px';
  $('#n-slider').append(nScrubber.elt);

  n.observe('numericValue', function() {
    nScrubber.value(n.numericValue);
  });

  rScrubber.min(0.1).max(2).value(model.rate).step(0.01);
  rScrubber.onValueChanged = function(val) {
    $rInput.val(val);
    model.setRate(val);
  };
  rScrubber.elt.style.width = '150px';
  $('#r-slider').append(rScrubber.elt);

  r.observe('numericValue', function() {
    rScrubber.value(r.numericValue);
  });

  kScrubber.min(0).max(1500).step(10).value(model.capacity);
  kScrubber.onValueChanged = function(val) {
    $kInput.val(val);
    model.setCapacity(val);
  };
  kScrubber.elt.style.width = '150px';
  $('#k-slider').append(kScrubber.elt);

  k.observe('numericValue', function() {
    kScrubber.value(k.numericValue);
  });

  tScrubber.min(0).max(10).step(0.01);
  tScrubber.onValueChanged = function(val) {
    $tInput.val(val);
    calc.setExpression({ id: 'T', latex: 'T=' + val });
  };
  tScrubber.onScrubStart = function(val) {
    // Kill animation if you grab the scrubber
    if (timeIsAnimating) {
      timeIsAnimating = false;
      $animation.removeClass('pause').addClass('play');
      $animation.text('Play');
    }
  };
  tScrubber.elt.style.width = '150px';
  $('#t-slider').append(tScrubber.elt);

  T.observe('numericValue', function() {
    tScrubber.value(T.numericValue);
  });

  function sanitizeInput(input) {
    return isNaN(input) ? 0 : input;
  }

  // Initialize inputs
  $nInput.val(model.initialPopulation);
  $nInput.on('change', function() {
    nScrubber.value(sanitizeInput($nInput.val()));
  });

  $rInput.val(model.rate);
  $rInput.on('change', function() {
    rScrubber.value(sanitizeInput($rInput.val()));
  });

  $kInput.val(model.capacity);
  $kInput.on('change', function() {
    kScrubber.value(sanitizeInput($kInput.val()));
  });

  $tInput.val(0);
  $tInput.on('change', function() {
    tScrubber.value(sanitizeInput($tInput.val()));
  });

  // The settings inputs
  $nMin.on('change', function() {
    var newVal = sanitizeInput($nMin.val());
    model.minPopulation = newVal;
    nScrubber.min(newVal);
    clampValue(nScrubber);
    model.computeSteps();
  });

  $nMax.on('change', function() {
    var newVal = sanitizeInput($nMax.val());
    model.maxPopulation = newVal;
    nScrubber.max(newVal);
    clampValue(nScrubber);
    model.computeSteps();
  });

  $rMin.on('change', function() {
    var newVal = sanitizeInput($rMin.val());
    model.minRate = newVal;
    rScrubber.min(newVal);
    clampValue(rScrubber);
    model.computeSteps();
  });

  $rMax.on('change', function() {
    var newVal = sanitizeInput($rMax.val());
    model.maxRate = newVal;
    rScrubber.max(newVal);
    clampValue(rScrubber);
    model.computeSteps();
  });

  $kMin.on('change', function() {
    var newVal = sanitizeInput($kMin.val());
    model.minCapacity = newVal;
    kScrubber.min(newVal);
    clampValue(kScrubber);
    model.computeSteps();
    model.updateBounds();
  });

  $kMax.on('change', function() {
    var newVal = sanitizeInput($kMax.val());
    model.maxCapacity = newVal;
    kScrubber.max(newVal);
    clampValue(kScrubber);
    model.computeSteps();
    model.updateBounds();
  });

  $tMax.on('change', function() {
    var newVal = sanitizeInput($tMax.val());
    model.maxTime = newVal;
    tScrubber.max(newVal);
    clampValue(tScrubber);
    model.computeSteps();
    model.updateBounds();
  });

});
