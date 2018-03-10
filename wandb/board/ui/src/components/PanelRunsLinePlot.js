import React from 'react';
import {connect} from 'react-redux';
import {bindActionCreators} from 'redux';
import _ from 'lodash';
import {Button, List, Loader, Form, Grid} from 'semantic-ui-react';
import HelpIcon from '../components/HelpIcon';
import LinePlot from '../components/vis/LinePlot';
import {color} from '../util/colors.js';
import {registerPanelClass} from '../util/registry.js';
import {
  runDisplayName,
  displayValue,
  groupByCandidates,
  groupConfigIdx,
} from '../util/runhelpers.js';
import {addFilter} from '../actions/run';
import * as Query from '../util/query';

const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
const arrMax = arr => arr.reduce((a, b) => Math.max(a, b));
const arrMin = arr => arr.reduce((a, b) => Math.min(a, b));
const xAxisLabels = {
  _step: 'Step',
  _runtime: 'Relative Time (s)',
  _timestamp: 'Absolute Time',
};

function smooth(data, smoothingWeight) {
  // data is array of x/y objects
  // x is always an index as this is used, so x-distance between each
  // successive point is equal.
  // 1st-order IIR low-pass filter to attenuate the higher-
  // frequency components of the time-series.
  let last = data.length > 0 ? 0 : NaN;
  let numAccum = 0;
  data.forEach((d, i) => {
    let nextVal = d.y;
    if (!_.isFinite(last)) {
      d.smoothed = nextVal;
    } else {
      last = last * smoothingWeight + (1 - smoothingWeight) * nextVal;
      numAccum++;
      // The uncorrected moving average is biased towards the initial value.
      // For example, if initialized with `0`, with smoothingWeight `s`, where
      // every data point is `c`, after `t` steps the moving average is
      // ```
      //   EMA = 0*s^(t) + c*(1 - s)*s^(t-1) + c*(1 - s)*s^(t-2) + ...
      //       = c*(1 - s^t)
      // ```
      // If initialized with `0`, dividing by (1 - s^t) is enough to debias
      // the moving average. We count the number of finite data points and
      // divide appropriately before storing the data.
      let debiasWeight = 1;
      if (smoothingWeight !== 1.0) {
        debiasWeight = 1.0 - Math.pow(smoothingWeight, numAccum);
      }
      d.smoothed = last / debiasWeight;
    }
  });
}

class RunsLinePlotPanel extends React.Component {
  static type = 'Run History Line Plot';
  static yAxisOptions = {};
  static xAxisOptions = {};
  static groupByOptions = {};

  constructor(props) {
    super(props);

    this.props.config.groupBy = 'None';
    this.props.config.xAxis = '_step';
  }

  static validForData(data) {
    return data && !_.isNil(data.histories);
  }

  scaledSmoothness() {
    return Math.sqrt(this.props.config.smoothingWeight || 0);
  }

  _groupByOptions() {
    let configs = this.props.data.selectedRuns.map((run, i) => run.config);

    let names = _.concat('None', groupByCandidates(configs));
    return names.map((name, i) => ({
      text: name,
      key: name,
      value: name,
    }));
  }

  renderConfig() {
    let {keys} = this.props.data.histories;
    let yAxisOptions = keys.map(key => ({
      key: key,
      value: key,
      text: key,
    }));
    let xAxisOptions = [
      {text: xAxisLabels['_step'], key: '_step', value: '_step'},
      {text: xAxisLabels['_runtime'], key: '_runtime', value: '_runtime'},
      {text: xAxisLabels['_timestamp'], key: '_timestamp', value: '_timestamp'},
    ];
    let groupByOptions = {};
    let disabled = this.props.data.histories.data.length === 0;
    return (
      <Form style={{marginTop: 10}}>
        <Grid>
          <Grid.Row>
            <Grid.Column width={14}>
              <Form.Field>
                <Form.Dropdown
                  label="X-Axis"
                  placeholder="xAxis"
                  fluid
                  search
                  selection
                  options={xAxisOptions}
                  value={this.props.config.xAxis}
                  onChange={(e, {value}) =>
                    this.props.updateConfig({
                      ...this.props.config,
                      xAxis: value,
                    })
                  }
                />
              </Form.Field>
            </Grid.Column>
          </Grid.Row>
          <Grid.Row>
            <Grid.Column width={14}>
              <Form.Field>
                <Form.Dropdown
                  disabled={disabled}
                  label="Y-Axis"
                  placeholder="key"
                  fluid
                  search
                  selection
                  options={yAxisOptions}
                  value={this.props.config.key}
                  onChange={(e, {value}) =>
                    this.props.updateConfig({
                      ...this.props.config,
                      key: value,
                    })
                  }
                />
              </Form.Field>
            </Grid.Column>
            <Grid.Column width={2} verticalAlign="bottom">
              <Button
                toggle
                icon
                active={this.props.config.yLogScale}
                onClick={(e, {value}) =>
                  this.props.updateConfig({
                    ...this.props.config,
                    yLogScale: !this.props.config.yLogScale,
                  })
                }>
                <svg
                  viewBox="0 0 24 24"
                  preserveAspectRatio="xMidYMid meet"
                  style={{
                    display: 'block',
                    width: '30px',
                    height: '30px',
                  }}>
                  <g>
                    <path d="M3 17h18v-2H3v2zm0 3h18v-1H3v1zm0-7h18v-3H3v3zm0-9v4h18V4H3z" />
                  </g>
                </svg>
              </Button>
            </Grid.Column>
          </Grid.Row>
          <Grid.Row>
            <Grid.Column width={4}>
              <Form.Field disabled={disabled}>
                <label>
                  Smoothing: {displayValue(this.scaledSmoothness())}
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.001}
                  value={this.props.config.smoothingWeight || 0}
                  onChange={e => {
                    this.props.updateConfig({
                      ...this.props.config,
                      smoothingWeight: parseFloat(e.target.value),
                    });
                  }}
                />
              </Form.Field>
            </Grid.Column>
            <Grid.Column width={6} verticalAlign="middle">
              <Form.Checkbox
                toggle
                label="Aggregate Runs"
                name="aggregate"
                onChange={(e, value) =>
                  this.props.updateConfig({
                    ...this.props.config,
                    aggregate: value.checked,
                  })
                }
              />
            </Grid.Column>
            <Grid.Column width={6}>
              <Form.Dropdown
                disabled={!this.props.config.aggregate}
                label="Group By"
                placeholder="groupBy"
                fluid
                search
                selection
                options={this._groupByOptions()}
                value={this.props.config.groupBy}
                onChange={(e, {value}) =>
                  this.props.updateConfig({
                    ...this.props.config,
                    groupBy: value,
                  })
                }
              />
            </Grid.Column>
          </Grid.Row>
        </Grid>
      </Form>
    );
  }

  smoothLine(lineData) {
    let smoothLineData = {name: lineData.name + '-smooth', data: []};
    if (this.props.config.smoothingWeight) {
      smooth(lineData, this.scaledSmoothness());
      smoothLineData = lineData.map(point => ({
        x: point.x,
        y: point.smoothed,
      }));
    }
    return smoothLineData;
  }

  aggregateLines(lines, name, idx) {
    let xtoy = {};
    lines.map(
      (line, j) => (
        console.log(line.data),
        line.data.map(
          (point, i) =>
            xtoy[point.x]
              ? xtoy[point.x].push(point.y)
              : (xtoy[point.x] = [point.y]),
        )
      ),
    );
    let line_data = _.map(xtoy, (yvals, xval) => ({
      x: Number(xval),
      y: avg(yvals),
    }));

    let area_data = _.map(xtoy, (yvals, xval) => ({
      x: Number(xval),
      y0: arrMin(yvals),
      y: arrMax(yvals),
    }));

    let area = {
      title: '_area ' + name,
      color: color(idx, 0.3),
      data: area_data,
      area: true,
    };

    let line = {
      title: 'Mean ' + name,
      color: color(idx),
      data: line_data,
    };
    return [line, area];
  }

  linesFromData(data, key) {
    if (!data || data.length == 0) {
      return [];
    }
    let xAxisKey = this.props.config.xAxis || '_step';
    let smoothing =
      this.props.config.smoothingWeight &&
      this.props.config.smoothingWeight > 0;

    let lines = data.map((runHistory, i) => ({
      name: runHistory.name,
      data: runHistory.history
        .map((row, j) => ({
          x: row[xAxisKey] || j, // Old runs might not have xAxisKey set
          y: row[key],
        }))
        .filter(point => !_.isNil(point.y)),
    }));

    if (this.props.config.aggregate) {
      let aggLines = [];
      if (this.props.config.groupBy != 'None') {
        let groupIdx = groupConfigIdx(
          this.props.data.selectedRuns.slice(0, lines.length),
          this.props.config.groupBy,
        );
        let i = 0;
        _.forOwn(groupIdx, (idxArr, configVal) => {
          let lineGroup = [];
          idxArr.map((idx, j) => {
            console.log('l', lines[idx], idx);
            lineGroup.push(lines[idx]);
          });
          aggLines = _.concat(
            aggLines,
            this.aggregateLines(
              lineGroup,
              key +
                ' ' +
                this.props.config.groupBy +
                ':' +
                displayValue(configVal),
              i++,
            ),
          );
        });
      } else {
        aggLines = this.aggregateLines(lines, key);
      }
      lines = aggLines;
    } else {
      lines = lines.filter(line => line.data.length > 0).map((line, i) => ({
        title: runDisplayName(this.props.data.filteredRunsById[line.name]),
        color: color(i, 0.8),
        data: line.data,
      }));
    }

    let smoothedLines = {};

    if (
      this.props.config.smoothingWeight &&
      this.props.config.smoothingWeight > 0
    ) {
      let origLines = lines.filter(line => line.title.startsWith('_'));
      smoothedLines = lines
        .filter(line => !line.title.startsWith('_'))
        .map((line, i) => {
          return {
            data: this.smoothLine(line.data),
            title: line.title,
            color: color(i, 0.8),
            name: line.name,
          };
        });
      lines = lines
        .filter(line => !line.title.startsWith('_'))
        .map((line, i) => {
          let newLine = line;
          newLine.title = '_' + newLine.title;
          newLine.color = color(i, 0.1);
          return newLine;
        });

      return _.concat(origLines, lines, smoothedLines);
    } else {
      return lines;
    }
  }

  renderNormal() {
    let {loading, data, maxRuns, totalRuns} = this.props.data.histories;
    data = data.filter(run => this.props.data.filteredRunsById[run.name]);

    let key = this.props.config.key;
    let lines = this.linesFromData(data, key);
    console.log('The Lines', lines);
    let title = key;
    if (this.props.panelQuery && this.props.panelQuery.strategy === 'merge') {
      let querySummary = Query.summaryString(this.props.panelQuery);
      if (querySummary) {
        title += ' (' + querySummary + ')';
      }
      if (this.props.panelQuery.model) {
        title = this.props.panelQuery.model + ':' + title;
      }
    }
    return (
      <div>
        <h3 style={{display: 'inline'}}>
          {title}
          {loading &&
            data.length < maxRuns && (
              <Loader
                style={{marginLeft: 6, marginBottom: 2}}
                active
                inline
                size="small"
              />
            )}
        </h3>
        <p style={{float: 'right'}}>
          {totalRuns > maxRuns && (
            <span>
              Limited to {maxRuns} of {totalRuns} selected runs{' '}
              <HelpIcon text="Run history plots are currently limited in the amount of data they can display. You can control runs displayed here by changing your selections." />
            </span>
          )}
        </p>
        <div style={{clear: 'both'}}>
          {this.props.data.base.length !== 0 &&
            data.length === 0 &&
            this.props.data.selectedRuns.length === 0 &&
            !loading && (
              <div
                style={{
                  zIndex: 10,
                  position: 'absolute',
                  height: 200,
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <div
                  style={{
                    maxWidth: 300,
                    backgroundColor: 'white',
                    border: '1px solid #333',
                    padding: 15,
                  }}>
                  <p>
                    Select runs containing <i>{key}</i> in their history.
                    <HelpIcon
                      content={
                        <div>
                          <p>You can select runs by:</p>
                          <List bulleted>
                            <List.Item>
                              Highlighting regions or axes in charts
                            </List.Item>
                            <List.Item>
                              Checking them in the table below
                            </List.Item>
                            <List.Item>
                              Manually adding selections above.
                            </List.Item>
                          </List>
                        </div>
                      }
                    />
                  </p>
                  <p style={{textAlign: 'center'}}> - or - </p>
                  <p style={{textAlign: 'center'}}>
                    <Button
                      content="Select All"
                      onClick={() =>
                        this.props.addFilter(
                          'select',
                          {section: 'run', value: 'id'},
                          '=',
                          '*',
                        )
                      }
                    />{' '}
                    {this.props.data.filtered.length} runs.
                  </p>
                </div>
              </div>
            )}
          {_.isNil(this.props.config.key) && (
            <div
              style={{
                zIndex: 10,
                position: 'absolute',
                height: 200,
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <div
                style={{
                  maxWidth: 300,
                  backgroundColor: 'white',
                  border: '1px solid #999',
                  padding: 15,
                  color: '#666',
                }}>
                <p>This chart is not yet configured</p>
              </div>
            </div>
          )}
          <LinePlot
            xAxis={xAxisLabels[this.props.config.xAxis]}
            yScale={this.props.config.yLogScale ? 'log' : 'linear'}
            xScale={this.props.config.xLogScale ? 'log' : 'linear'}
            lines={lines}
            sizeKey={this.props.sizeKey}
            currentHeight={this.props.currentHeight}
          />
        </div>
      </div>
    );
  }

  render() {
    this.lines = this.props.config.lines || [];
    if (this.props.configMode) {
      return (
        <div>
          {this.renderNormal()}
          {this.renderConfig()}
        </div>
      );
    } else {
      return this.renderNormal();
    }
  }
}
registerPanelClass(RunsLinePlotPanel);

const mapDispatchToProps = (dispatch, ownProps) => {
  return bindActionCreators({addFilter}, dispatch);
};

let ConnectRunsLinePlotPanel = connect(null, mapDispatchToProps)(
  RunsLinePlotPanel,
);
ConnectRunsLinePlotPanel.type = RunsLinePlotPanel.type;
ConnectRunsLinePlotPanel.options = RunsLinePlotPanel.yAxisOptions;
ConnectRunsLinePlotPanel.validForData = RunsLinePlotPanel.validForData;

registerPanelClass(ConnectRunsLinePlotPanel);
