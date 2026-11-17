// small flash msg helper, didnt want another package for this
module.exports = function flash(req, res, next) {
  req.flash = (type, msg) => {
    req.session.flash = req.session.flash || [];
    req.session.flash.push({ type, msg });
  };
  res.locals.flashes = req.session.flash || [];
  req.session.flash = [];
  next();
};
