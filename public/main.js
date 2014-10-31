// Wait for DOM to finish loading.
$(document).ready(function() {
    // Ready!
    console.log('READY!');

    var createData = function(collection, source, type, date, value) {
        return $.ajax({
            type: "POST",
            url: "/api/v1/"+collection+"/data",
            processData: false,
            contentType: 'application/json',
            data: JSON.stringify({
                source: source,
                type: type,
                date: date,
                value: value
            })
        });
    };
    window.createData = createData;

    var testSensor = window.testSensor = function(date,n ) {
        for (var v=0;v<n;v++) {
            var value = 1000 * Math.random();
            createData('testData','plant',"sensor "+v, date, value);
        }
    }

    var bulkTest = window.bulkTest = function(n, start, end) {
        start = +(new Date(start));
        end = +(new Date(end));
        var delta = Math.ceil((end - start)/1000);
        for (var i=0;i<delta;i++) {
            var date = new Date(start+i*1000);
            testSensor(date, n);
        }
    }

    var startRealtimeTest = window.startRealtimeTest = function(n) {
        setInterval(function() {
            testSensor(new Date(), n);
        }, 1000);
    }


    var aggregate = function(collection, pipeline, options, callback) {
        return $.get(
            "/api/v1/"+collection+"/aggregate",
            {
                "pipeline": JSON.stringify(pipeline || []),
                "options": JSON.stringify(options || {})
            }
        )
        .done(function(results) {
            return callback && callback(results);
        })
        .fail(function() {
            console.log('fail', arguments);
        });
    };
    window.aggregate = aggregate;

    var graphDiscreteBarChart = function(selector, title, collection, pipeline, options, transform) {

        // Aggretation Framework query
        aggregate(collection,
            pipeline,
            options,
            function(results) {
                if (typeof transform === "function") {
                    results = transform(results);
                }
                var data = [{
                    key: title,
                    values: results
                }];
                console.log(data);

                // Discrete Bar Graph
                nv.addGraph(function() {
                  var chart = nv.models.discreteBarChart()
                      .x(function(d) { return d.label })    //Specify the data accessors.
                      .y(function(d) { return d.value })
                      .staggerLabels(true)    //Too many bars and not enough room? Try staggering labels.
                      .tooltips(false)        //Don't show tooltips
                      .showValues(true)       //...instead, show the bar value right on top of each bar.
                      .transitionDuration(350)
                      ;

                  d3.select(selector)
                      .datum(data)
                      .call(chart);

                  nv.utils.windowResize(chart.update);

                  return chart;
                });
        });

    };


    var graphPieChart = function(selector, title, collection, pipeline, options) {

        // Aggretation Framework query
        aggregate(collection,
            pipeline,
            options,
            function(results) {
                var data = results;
                /*
                var data = [{
                    key: title,
                    values: results
                }];
                */
                console.log(data);

                // Pie Chart Graph
                //Regular pie chart example
                nv.addGraph(function() {
                  var chart = nv.models.pieChart()
                      .x(function(d) { return d.label })
                      .y(function(d) { return d.value })
                      .showLabels(true);

                    d3.select(selector)
                        .datum(data)
                        .transition().duration(350)
                        .call(chart);

                  return chart;
                });

        });

    };

    var graphLineChart = function(selector, title, collection, pipeline, options, transform) {

        // Aggretation Framework query
        aggregate(collection,
            pipeline,
            options,
            function(results) {
                var data = [{
                    key: title,
                    values: results
                }];
                if (typeof transform === "function") {
                    data = transform(results);
                }
                // console.log(data);

                var chart = window['chart-'+selector];
                if (chart)
                {
                    d3.select(selector)
                        .datum(data)
                        .call(chart);
                    nv.utils.windowResize(chart.update);
                    return chart;
                }

                // Discrete Bar Graph
                nv.addGraph(function() {
                  chart = nv.models.lineWithFocusChart()
                      .x(function(d) { return d.label })    //Specify the data accessors.
                      .y(function(d) { return d.value })
                    //   .staggerLabels(true)    //Too many bars and not enough room? Try staggering labels.
                    //   .tooltips(false)        //Don't show tooltips
                    //   .showValues(true)       //...instead, show the bar value right on top of each bar.
                      .transitionDuration(350)
                      ;

                  d3.select(selector)
                      .datum(data)
                      .call(chart);

                  nv.utils.windowResize(chart.update);

                  window['chart-'+selector] = chart;

                  return chart;
                });
        });

    };

    // Graph it!
    poll = function() {
            graphLineChart(
            "#charts svg#lineDemo-1",
            "testData Line Chart",
            "testData",
            [],
            {},
            function(data) {
                var result = [];
                var cache = {};
                // Create space for minutes
                // var d = (new Date()).getUTCHours();
                for (var d=0,len=data.length; d<len;d++) {
                    var doc = data[d];
                    if (doc) {
                        var key = doc._id.source + " - " + doc._id.type;
                        var c = cache[key];
                        if (!c) {
                            c = {
                                key: key,
                                values: []
                            };
                            result.push(c);
                        }
                        var date = new Date(doc._id.date);
                        for (var m=0;m<=59;m++) {
                            // Create space for seconds
                            for (var s=0;s<=59;s++) {
                                value = doc.values[m][s];
                                date.setUTCMinutes(m);
                                date.setUTCSeconds(s);
                                if (value) {
                                    c.values.push({
                                        label: (date).getTime()/1000,
                                        value: value
                                    })
                                }
                            }
                        }
                        cache[key] = c;
                    }
                }
                return result;
            }
        );
    }
    setInterval(poll, 1000);


    var context = cubism.context()
        .step(1e4)
        .size(1440);
    var horizon = context.horizon();
    horizon.extent([-10, 10]);

    var selector = "#charts div#lineDemo-2";
    d3.select(selector)
        .selectAll(".axis")
        .data(["top", "bottom"])
      .enter().append("div")
        .attr("class", function(d) { return d + " axis"; })
        .each(function(d) { d3.select(this).call(context.axis().ticks(12).orient(d)); });

    d3.select(selector).append("div")
        .attr("class", "rule")
        .call(context.rule());

    d3.select(selector).selectAll(".horizon")
        .data(d3.range(1, 50).map(random))
      .enter().insert("div", ".bottom")
        .attr("class", "horizon")
        .call(horizon);

    context.on("focus", function(i) {
      d3.selectAll(".value").style("right", i == null ? null : context.size() - i + "px");
    });

    // Replace this with context.graphite and graphite.metric!
    function random(x) {
      var value = 0,
          values = [],
          i = 0,
          last;
      return context.metric(function(start, stop, step, callback) {
        start = +start, stop = +stop;
        if (isNaN(last)) last = start;
        while (last < stop) {
          last += step;
          value = Math.max(-10, Math.min(10, value + .8 * Math.random() - .4 + .2 * Math.cos(i += x * .02)));
          values.push(value);
        }
        callback(null, values = values.slice((start - stop) / step));
      }, x);
    }

});
